const EventEmitter = require("events");
class GPU extends EventEmitter {
  constructor() {
    super();
    this.bitMaps = [];
  }
}
const gpu = new GPU();

module.exports = gpu;
