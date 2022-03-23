const http = require("http");
const htmlparser2 = require("htmlparser2");
const css = require("css");
const { createCanvas } = require("canvas");
const fs = require("fs");
const main = require("./main");
const network = require("./network");
const render = require("./render");
const gpu = require("./gpu");

const loadingLinks = {};
const loadingScripts = {};

const host = "localhost";
const port = 80;

// 实现数组的top方法，模拟栈结构的api
Array.prototype.top = function () {
  return this[this.length - 1];
};

/**
 * 主流程
 * 1. 主进程接收用户输入的url
 * 2. 主进程把该url转发给网络进程
 * 3. 网络进程中发起url请求
 * 4. 网络进程接收到响应头数据并转发给主进程
 * 5. 主进程发送提交导航消息到渲染进程
 */

// ============ 主进程 ==============
main.on("drawQuad", () => {
  // p. 浏览器主进程然后从gpu内存中取出位图显示到页面上
  let drawSteps = gpu.bitMaps.flat();
  const canvas = createCanvas(150, 250);
  const ctx = canvas.getContext("2d");
  eval(drawSteps.join("\r\n"));
  fs.writeFileSync("result.png", canvas.toBuffer("image/pngF"));
});
main.on("request", (options) => {
  // 2. 主进程把该url转发给网络进程
  network.emit("request", options);
});
main.on("prepareRender", (options) => {
  // 5. 主进程发送提交导航消息到渲染进程
  render.emit("commitNavigation", options);
});
main.on("confirmNavigation", () => {
  console.log("confirmNavigation");
});
main.on("DOMContentLoaded", () => {
  console.log("DOMContentLoaded");
});
main.on("Load", () => {
  console.log("Load");
});
// ============ 网络进程 ==============
network.on("request", (options) => {
  // 3. 网络进程中发起url请求
  let request = http.request(options, (response) => {
    // 4. 网络进程接收到响应头数据并转发给主进程
    main.emit("prepareRender", response);
  });
  request.end();
});
// ============ 渲染进程 ==============
// 6. 渲染进程开始从网络进程接收HTML
render.on("commitNavigation", (response) => {
  const headers = response.headers;
  const contentType = headers["content-type"];
  if (contentType.indexOf("text/html") !== -1) {
    // a. 渲染进程把HTML转变为DOM树形结构
    const document = {
      type: "document",
      attributes: {},
      children: [],
    };
    const cssRules = [];
    // token栈
    const tokenStack = [document];
    // html解析器
    const parser = new htmlparser2.Parser({
      onopentag(name, attributes = {}) {
        // 取栈顶元素作为父元素
        const parent = tokenStack.top();
        const element = {
          type: "element",
          tagName: name,
          children: [],
          attributes,
          parent,
        };
        // 把元素push进parent.children
        parent.children.push(element);
        // 再把元素push进token栈
        tokenStack.push(element);
      },
      ontext(text) {
        // 匹配换行回车空格
        if (!/^[\r\n\s]*$/.test(text)) {
          const parent = tokenStack.top();
          const textNode = {
            type: "text",
            children: [],
            attributes: {},
            parent,
            text,
          };
          parent.children.push(textNode);
        }
      },
      /**
       * 在预解析阶段，HTML发现CSS和JS文件会并行下载，等全部下载后先把CSS生成CSSOM，然后再执行JS脚本
       * 然后再构建DOM树，重新计算样式，构建布局树，绘制页面
       * @param {*} tagname
       */
      onclosetag(tagName) {
        // b. css转stylesheet
        switch (tagName) {
          case "style":
            const styleToken = tokenStack.top();
            const cssAST = css.parse(styleToken.children[0].text);
            cssRules.push(...cssAST.stylesheet.rules);
            break;
          case "link":
            const linkToken = tokenStack[tokenStack.length - 1];
            const href = linkToken.attributes.href;
            const options = { host, port, path: href };
            // 外链的css，发起网络请求，数据回来后push进stylesheet
            const promise = network.fetchResource(options).then(({ body }) => {
              delete loadingLinks[href];
              const cssAST = css.parse(body);
              cssRules.push(...cssAST.stylesheet.rules);
            });
            loadingLinks[href] = promise;
            break;
          case "script":
            const scriptToken = tokenStack[tokenStack.length - 1];
            const src = scriptToken.attributes.src;
            if (src) {
              const options = { host, port, path: src };
              const promise = network
                .fetchResource(options)
                .then(({ body }) => {
                  delete loadingScripts[src];
                  // script的执行，需要等之前所有的link、script加载完毕
                  return Promise.all([
                    ...Object.values(loadingLinks),
                    Object.values(loadingScripts),
                  ]).then(() => {
                    eval(body);
                  });
                });
              loadingScripts[src] = promise;
            } else {
              const script = scriptToken.children[0].text;
              const ts = Date.now() + "";
              // script的执行，需要等之前所有的link、script加载完毕
              const promise = Promise.all([
                ...Object.values(loadingLinks),
                ...Object.values(loadingScripts),
              ]).then(() => {
                delete loadingScripts[ts];
                eval(script);
              });
              loadingScripts[ts] = promise;
            }
            break;
          default:
            break;
        }
        tokenStack.pop();
      },
    });
    // 开始接收响应体
    response.on("data", (buffer) => {
      // 8. 渲染进程开始HTML解析和加载子资源
      // 网络进程加载了多少数据，HTML 解析器便解析多少数据。
      parser.write(buffer.toString());
    });
    response.on("end", () => {
      // 页面渲染，会受script的加载阻塞
      Promise.all(Object.values(loadingScripts)).then(() => {
        // 7. html接收完毕后通知主进程确认导航
        main.emit("confirmNavigation");
        // c. 通过stylesheet计算出DOM节点的样式
        recalculateSyle(cssRules, document);
        // d. 根据DOM树创建布局树,就是复制DOM结构并过滤掉不显示的元素
        const html = document.children[0];
        const body = html.children[1];
        const layoutTree = createLayout(body);
        // e. 计算各个元素的布局信息
        updateLayoutTree(layoutTree);
        // f. 根据布局树生成分层树
        const layers = [layoutTree];
        createLayerTree(layoutTree, layers);
        // g. 根据分层树生成绘制步骤并复合图层
        const paintSteps = compositeLayers(layers);
        // i. 把绘制步骤交给渲染进程中的合成线程进行合成
        // j. 合成线程会把图层划分为图块tile
        const tiles = splitTiles(paintSteps);
        // k. 合成线程会把分好的图块发给栅格化线程池
        console.log("tiles", tiles);
        raster(tiles);
        // 触发DOMContentLoaded事件
        main.emit("DOMContentLoaded");
        // 9. html解析完毕和加载子资源页面加载完成后会通知主进程页面加载完成
        main.emit("Load");
      });
    });
  }
});
// ============ gpu进程 ==============
gpu.on("raster", (tile) => {
  // o. 最终生成的位图久保存在了GPU内存中
  let bitMap = tile;
  gpu.bitMaps.push(bitMap);
});
// 模拟把图层拆成图块的过程
function splitTiles(paintSteps) {
  return paintSteps;
}
function raster(tiles) {
  // l. 栅格化线程会把图片tile转化成位图
  tiles.forEach((tile) => rasterThread(tile));
  // n. 当所有的图块都光栅化之后，合成线程会发送绘制的命令给浏览器主进程
  main.emit("drawQuad");
}
function rasterThread(tile) {
  // m. 而其实栅格化线程在工作的时候，会把栅格化的工作交给gpu进程来完成
  gpu.emit("raster", tile);
}
function compositeLayers(layers) {
  // h. 合成线程会把分好的图块发给栅格化线程池，栅格化线程池会把图块tile转化为位图
  return layers.map((layout) => paint(layout));
}
function paint(element, paintSteps = []) {
  const {
    background = "black",
    color = "black",
    top = 0,
    left = 0,
    width = 100,
    height = 0,
  } = element.layout;
  // 使用canvas模拟绘制的过程
  if (element.type === "text") {
    paintSteps.push(`ctx.font = '20px Impact;'`);
    paintSteps.push(`ctx.strokeStyle = '${color}';`);
    paintSteps.push(
      `ctx.strokeText("${element.text.replace(/(^\s+|\s+$)/g, "")}", ${left}, ${
        top + 20
      });`
    );
  } else {
    paintSteps.push(`ctx.fillStyle="${background}";`);
    paintSteps.push(
      `ctx.fillRect(${left},${top}, ${parseInt(width)}, ${parseInt(height)});`
    );
    element.children.forEach((child) => paint(child, paintSteps));
    return paintSteps;
  }
}
function createLayerTree(element, layers) {
  element.children = element.children.filter((child) =>
    createNewLayer(child, layers)
  );
  element.children.forEach((child) => createLayerTree(child, layers));
  return layers;
}
function createNewLayer(element, layers) {
  let created = true;
  const attributes = element.attributes;
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === "style") {
      const attributes = value.split(";");
      attributes.forEach((attribute) => {
        const [property, value] = attribute.split(/:\s*/);
        if (property === "position" && value === "absolute") {
          updateLayoutTree(element); // 对单独的层重新计算
          layers.push(element);
          created = false;
        }
      });
    }
  });
}
function updateLayoutTree(element, top = 0, parentTop = 0) {
  const computedSyle = element.computedSyle;
  const { width, height, background, color } = computedSyle;
  element.layout = {
    top: top + parentTop,
    left: 0,
    width,
    height,
    background,
    color,
  };
  let childTop = 0;
  element.children.forEach((child) => {
    // 递归子元素
    updateLayoutTree(child, childTop, element.layout.top);
    childTop += parseInt(child.computedSyle.height || 0);
  });
}
function createLayout(element) {
  // 过滤
  element.children = element.children.filter(isShow);
  // 递归
  element.children.forEach((child) => createLayout(child));
  // 返回
  return element;
}
function isShow(element) {
  let isShow = true;
  if (element.tagName === "head" || element.tagName === "script") {
    isShow = false;
  }
  const attributes = element.attributes;
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === "style") {
      const attributes = value.split(";");
      attributes.forEach((attribute) => {
        const [property, value] = attribute.split(/:\s*/);
        if (property === "display" && value === "none") {
          isShow = false;
        }
      });
    }
  });
  return isShow;
}
function recalculateSyle(cssRules, element, parentComputedStyle = {}) {
  const attributes = element.attributes;
  element.computedSyle = {
    color: parentComputedStyle.color, // 继承
  };
  Object.entries(attributes).forEach(([key, value]) => {
    cssRules.forEach((rule) => {
      let selector = rule.selectors[0].replace(/\s+/g, "");
      if (
        (selector === "#" + value && key === "id") ||
        (selector === "." + value && key === "class")
      ) {
        rule.declarations.forEach(({ property, value }) => {
          element.computedSyle[property] = value;
        });
      }
    });
    if (key === "style") {
      const attributes = value.split(";");
      attributes.forEach((attribute) => {
        const [property, value] = attribute.split(/:\s*/);
        element.computedSyle[property] = value;
      });
    }
  });
  // 递归，实现css样式的继承
  element.children.forEach((child) =>
    recalculateSyle(cssRules, child, element.computedSyle)
  );
}

// 1. 主进程接收用户输入的url
// main.emit("request", { host, port, path: "/index.html" });
main.emit("request", { host, port, path: "/load.html" });
