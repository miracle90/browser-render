const EventEmitter = require("events");
const http = require("http");

class Network extends EventEmitter {
  fetchResource(options) {
    return new Promise((resolve) => {
      // 在网络进程中发起URL请求
      let request = http.request(options, (response) => {
        // 网络进程接收到响应头数据并转发给主进程
        const headers = response.headers;
        const buffers = [];
        response.on("data", (buffer) => {
          buffers.push(buffer);
        });
        response.on("end", () => {
          resolve({ headers, body: Buffer.concat(buffers).toString() });
        });
      });
      // 结束请求体
      request.end();
    });
  }
}

const network = new Network();

module.exports = network;
