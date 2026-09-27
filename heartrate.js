// heartrate.js — lee la FC de cualquier emisor Bluetooth estándar (servicio 0x180D):
// pulsómetro de pecho Garmin, o el propio reloj con "Broadcast Heart Rate" activado
// (Venu Sq 2: Ajustes > Sensores y accesorios > FC de muñeca > Emitir FC).

const HR_SERVICE = 0x180d;
const CHAR_HR_MEASUREMENT = 0x2a37;

class HeartRateConnection {
  constructor() {
    this.device = null;
    this.connected = false;
    this.onData = null; // (bpm) => void
    this.onStatusChange = null;
  }

  static isSupported() {
    return !!navigator.bluetooth;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE] }],
      optionalServices: [HR_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      if (this.onStatusChange) this.onStatusChange('disconnected');
    });

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(HR_SERVICE);
    const char = await service.getCharacteristic(CHAR_HR_MEASUREMENT);
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (e) => this._parse(e.target.value));

    this.connected = true;
    if (this.onStatusChange) this.onStatusChange('connected');
  }

  _parse(dataView) {
    const flags = dataView.getUint8(0);
    let bpm;
    if (flags & 0x01) {
      bpm = dataView.getUint16(1, true); // formato UINT16
    } else {
      bpm = dataView.getUint8(1); // formato UINT8 (lo habitual)
    }
    if (this.onData) this.onData(bpm);
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.connected = false;
  }
}

window.HeartRateConnection = HeartRateConnection;
