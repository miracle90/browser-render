//6.渲染进程开始从网络进程接收HTML数据
render.on("commitNavigation", function (response) {
  const headers = response.headers;
  const contentType = headers["content-type"];
  if (contentType.indexOf("text/html") !== -1) {
    //1. 渲染进程把HTML转变为DOM树型结构
    const document = { type: "document", attributes: {}, children: [] };
    const cssRules = [];
    const tokenStack = [document];
    const parser = new htmlparser2.Parser({
      onopentag(name, attributes = {}) {
        const parent = tokenStack.top();
        const element = {
          type: "element",
          tagName: name,
          children: [],
          attributes,
          parent,
        };
        parent.children.push(element);
        tokenStack.push(element);
      },
      ontext(text) {
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
      onclosetag(tagName) {
        switch (tagname) {
          case "style":
            const styleToken = tokenStack.top();
            const cssAST = css.parse(styleToken.children[0].text);
            cssRules.push(...cssAST.stylesheet.rules);
            break;
          default:
            break;
        }
        tokenStack.pop();
      },
    });
    response.on("data", (buffer) => {
      //8.渲染进程开始HTML解析和加载子资源
      //网络进程加载了多少数据，HTML 解析器便解析多少数据。
      parser.write(buffer.toString());
    });
    response.on("end", () => {
      //7.HTML接收接受完毕后通知主进程确认导航
      main.emit("confirmNavigation");
      //3. 通过stylesheet计算出DOM节点的样式
      recalculateStyle(cssRules, document);
      //4. 根据DOM树创建布局树,就是复制DOM结构并过滤掉不显示的元素
      const html = document.children[0];
      const body = html.children[1];
      const layoutTree = createLayout(body);
      //5.并计算各个元素的布局信息
      updateLayoutTree(layoutTree);
      //6. 根据布局树生成分层树
      const layers = [layoutTree];
      createLayerTree(layoutTree, layers);
      console.log(layers);
      //触发DOMContentLoaded事件
      main.emit("DOMContentLoaded");
      //9.HTML解析完毕和加载子资源页面加载完成后会通知主进程页面加载完成
      main.emit("Load");
    });
  }
});
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
          updateLayoutTree(element); //对单独的层重新计算位置
          layers.push(element);
          created = false;
        }
      });
    }
  });
  return created;
}
function updateLayoutTree(element, top = 0, parentTop = 0) {
  const computedStyle = element.computedStyle;
  element.layout = {
    top: top + parentTop,
    left: 0,
    width: computedStyle.width,
    height: computedStyle.height,
    background: computedStyle.background,
    color: computedStyle.color,
  };
  let childTop = 0;
  element.children.forEach((child) => {
    updateLayoutTree(child, childTop, element.layout.top);
    childTop += parseInt(child.computedStyle.height || 0);
  });
}
function createLayout(element) {
  element.children = element.children.filter(isShow);
  element.children.forEach((child) => createLayout(child));
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
function recalculateStyle(cssRules, element, parentComputedStyle = {}) {
  const attributes = element.attributes;
  element.computedStyle = { color: parentComputedStyle.color }; // 计算样式
  Object.entries(attributes).forEach(([key, value]) => {
    //stylesheets
    cssRules.forEach((rule) => {
      let selector = rule.selectors[0].replace(/\s+/g, "");
      if (
        (selector == "#" + value && key == "id") ||
        (selector == "." + value && key == "class")
      ) {
        rule.declarations.forEach(({ property, value }) => {
          element.computedStyle[property] = value;
        });
      }
    });
    //行内样式
    if (key === "style") {
      const attributes = value.split(";");
      attributes.forEach((attribute) => {
        const [property, value] = attribute.split(/:\s*/);
        element.computedStyle[property] = value;
      });
    }
  });
  element.children.forEach((child) =>
    recalculateStyle(cssRules, child, element.computedStyle)
  );
}
//1.主进程接收用户输入的URL
main.emit("request", { host, port, path: "/html.html" });
