// ftms.js — control de un rodillo inteligente vía Bluetooth FTMS (Fitness Machine Service)
// Protocolo estándar Bluetooth SIG: funciona con cualquier rodillo compatible con FTMS
// (Elite Direto XRT incluido). Basado en la especificación pública de FTMS.
//
// Gotcha importante (documentado en varios proyectos open-source): el Control Point
// (0x2AD9) responde con INDICACIONES, no con la simple confirmación de escritura BLE.
// Hay que esperar la indicación de cada comando antes de mandar el siguiente, o el
// rodillo puede ignorar comandos en silencio.

const FTMS_SERVICE = 0x1826;
const CHAR_INDOOR_BIKE_DATA = 0x2ad2;
const CHAR_CONTROL_POINT = 0x2ad9;
const CHAR_MACHINE_STATUS = 0x2ada;

const OPCODE_REQUEST_CONTROL = 0x00;
const OPCODE_RESET = 0x01;
const OPCODE_SET_TARGET_POWER = 0x05;
const OPCODE_START_RESUME = 0x07;
const OPCODE_STOP_PAUSE = 0x08;

class TrainerConnection {
  constructor() {
    this.device = null;
    this.server = null;
    this.controlChar = null;
    this.bikeDataChar = null;
    this.connected = false;
    this._pending = null; // {resolve, reject, opcode, timeout}
    this.onData = null; // ({power, cadence, speedKmh}) => void
    this.onStatusChange = null; // ('connected'|'disconnected'|'warning', msg?) => void
  }

  static isSupported() {
    return !!navigator.bluetooth;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }],
      optionalServices: [FTMS_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      if (this.onStatusChange) this.onStatusChange('disconnected');
    });

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(FTMS_SERVICE);

    this.bikeDataChar = await service.getCharacteristic(CHAR_INDOOR_BIKE_DATA);
    await this.bikeDataChar.startNotifications();
    this.bikeDataChar.addEventListener('characteristicvaluechanged', (e) =>
      this._parseBikeData(e.target.value)
    );

    this.controlChar = await service.getCharacteristic(CHAR_CONTROL_POINT);
    await this.controlChar.startNotifications();
    this.controlChar.addEventListener('characteristicvaluechanged', (e) =>
      this._handleControlIndication(e.target.value)
    );

    // Handshake FTMS: pedir control antes de nada.
    await this._writeControl(OPCODE_REQUEST_CONTROL);

    // Algunos rodillos exigen "Start/Resume" antes de aceptar Set Target Power;
    // otros lo ignoran. Se intenta, pero no es fatal si falla.
    try {
      await this._writeControl(OPCODE_START_RESUME);
    } catch (err) {
      console.warn('Start/Resume no confirmado (puede ser normal en este rodillo):', err);
    }

    this.connected = true;
    if (this.onStatusChange) this.onStatusChange('connected');
  }

  _handleControlIndication(dataView) {
    if (!this._pending) return;
    const responseCode = dataView.getUint8(0); // debe ser 0x80
    const reqOp = dataView.getUint8(1);
    const result = dataView.getUint8(2); // 0x01 = éxito
    if (responseCode !== 0x80 || reqOp !== this._pending.opcode) return;

    clearTimeout(this._pending.timeout);
    if (result === 0x01) {
      this._pending.resolve(true);
    } else {
      this._pending.reject(new Error('El rodillo rechazó el comando (código ' + result + ')'));
    }
    this._pending = null;
  }

  _writeControl(opcode, paramBytes = []) {
    return new Promise((resolve, reject) => {
      if (this._pending) {
        // Hay otro comando esperando confirmación: no lo pisamos. Devolvemos false
        // para que quien llama lo reintente en el siguiente tick.
        resolve(false);
        return;
      }
      const payload = new Uint8Array([opcode, ...paramBytes]);
      const timeout = setTimeout(() => {
        // El rodillo no confirmó a tiempo: no bloqueamos la app para siempre,
        // seguimos adelante con un aviso.
        if (this._pending && this._pending.opcode === opcode) {
          console.warn('Sin indicación FTMS para opcode', opcode, '- se continúa igualmente');
          this._pending.resolve(false);
          this._pending = null;
        }
      }, 1500);

      this._pending = { resolve, reject, opcode, timeout };

      this.controlChar.writeValueWithResponse(payload).catch((err) => {
        clearTimeout(timeout);
        this._pending = null;
        reject(err);
      });
    });
  }

  // Devuelve true si el rodillo confirmó el vatiaje, false si no (hay que reintentar).
  async setTargetPower(watts) {
    const w = Math.max(0, Math.round(watts));
    const buf = new ArrayBuffer(2);
    new DataView(buf).setInt16(0, w, true); // SINT16 little-endian, resolución 1W
    return this._writeControl(OPCODE_SET_TARGET_POWER, Array.from(new Uint8Array(buf)));
  }

  async pause() {
    await this._writeControl(OPCODE_STOP_PAUSE, [0x02]); // 0x02 = pausa (0x01 sería stop total)
  }

  async resume() {
    await this._writeControl(OPCODE_START_RESUME);
  }

  _parseBikeData(dataView) {
    let offset = 0;
    const flags = dataView.getUint16(offset, true);
    offset += 2;

    let speedKmh = null;
    let cadence = null;
    let power = null;

    if (!(flags & 0x0001)) {
      // bit0 = 0 -> instantaneous speed presente (contraintuitivo, así lo define FTMS)
      speedKmh = dataView.getUint16(offset, true) * 0.01;
      offset += 2;
    }
    if (flags & 0x0002) offset += 2; // average speed, no lo usamos
    if (flags & 0x0004) {
      cadence = dataView.getUint16(offset, true) * 0.5; // resolución 0.5 rpm
      offset += 2;
    }
    if (flags & 0x0008) offset += 2; // average cadence
    if (flags & 0x0010) offset += 3; // total distance (24-bit)
    if (flags & 0x0020) offset += 2; // resistance level
    if (flags & 0x0040) {
      power = dataView.getInt16(offset, true);
      offset += 2;
    }
    // el resto de campos (potencia media, energía, FC del propio rodillo, tiempo...)
    // no se leen en la v1: la FC viene del reloj/pulsómetro por su propio servicio BLE.

    if (this.onData) this.onData({ power, cadence, speedKmh });
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.connected = false;
  }
}

window.TrainerConnection = TrainerConnection;
