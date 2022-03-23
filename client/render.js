const EventEmitter = require("events");
class Render extends EventEmitter {}
const render = new Render();

module.exports = render;