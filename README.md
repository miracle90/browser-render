> ### 相关问题
> * [什么是重排，重绘?](#reflow-repaint)
> * [怎样避免重排，重绘?](#avoid-reflow-repaint)
> * [什么是文档的预解析?](#document-pre-parse)
> * [说一下你对进程和线程的了解?区别？](#process-thread)
> * [浏览器都有哪些进程，渲染进程中都有什么线程?](#browser-process)

## 1. 进程和架构

将渲染流程之前先讲一下浏览器的大致架构吧，方便后面的理解

### 1.1 进程和线程

* 当启动一个程序时，操作系统会为该程序分配内存，用来存放代码、运行过程中的数据，这样的运行环境叫做**进程**
* 一个进程可以启动和管理多个**线程**，线程之间可以共享数据，任何一个线程出错都可能导致进程崩溃

### 1.2 Chrome的进程架构

* **浏览器主进程** 负责界面显示、用户交互和子进程管理
* **渲染进程** 排版引擎和v8引擎运行在该进程中，负责把html、css、js转变成网页
* **网络进程** 用来加载网络资源
* **GPU进程** 用来实现css3和3D效果

## 2. 加载html

1. 主进程接收用户输入的url
1. 主进程把该url转发给网络进程
1. 在网络进程中发起请求
1. 网络进程接收到响应头数据并转发给主进程
1. 主进程发送提交导航消息到渲染进程
1. 渲染进程开始从网络进程接收HTML数据
1. HTML接收完毕后通知主进程确认导航
1. 渲染进程开始HTML解析和加载子资源
1. HTML解析完毕和加载子资源页面加载完成后会通知主进程页面加载完成 

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/fa8b7646c97e4bcfa65886a0aefbd70b~tplv-k3u1fbpfcp-watermark.image?)

代码撸起~

> #### [完整项目地址](https://github.com/miracle90/browser-render)

### 2.1 安装npm包

* **canvas** 模拟gpu绘制
* **css** css解析器
* **express** 起一个服务，用来访问html
* **htmlparser2** html解析器

```
yarn add canvas css express htmlparser2
```

### 2.2 server\index.js

```js
const express = require("express");
const app = express();
app.use(express.static("public"));
app.listen(80, () => {
  console.log("server started at 80");
});
```

### 2.3 server\public\index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>浏览器渲染</title>
  </head>
  <body>
    <div>hellow</div>
    <div>world</div>
  </body>
</html>
```

### 2.4 client\request.js

```js
const http = require("http");
const main = require("./main");
const network = require("./network");
const render = require("./render");

const host = "localhost";
const port = 80;

/**
 * 主流程
 * 1. 主进程接收用户输入的url
 * 2. 主进程把该url转发给网络进程
 * 3. 网络进程中发起url请求
 * 4. 网络进程接收到响应头数据并转发给主进程
 * 5. 主进程发送提交导航消息到渲染进程
 */

// ============ 主进程 ==============
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
network.on("request", () => {
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
  // 开始接收响应体
  const buffers = [];
  response.on("data", (buffer) => {
    // 8. 渲染进程开始HTML解析和加载子资源
    buffers.push(buffer);
  });
  response.on("end", () => {
    let resultBuffer = Buffer.concat(buffers);
    let html = resultBuffer.toString();
    console.log(html);
    // 7. html接收完毕后通知主进程确认导航
    main.emit("confirmNavigation", html);
    // 触发DOMContentLoaded事件
    main.emit("DOMContentLoaded", html);
    // 9. html解析完毕和加载子资源页面加载完成后会通知主进程页面加载完成
    main.emit("Load");
  });
});

// 1. 主进程接收用户输入的url
main.emit("request", { host, port, path: "./index.html" });
```

### 2.5 client\render.js

```js
const EventEmitter = require("events");
class Render extends EventEmitter {}
const render = new Render();

module.exports = render;
```

### 2.6 client\network.js

```js
const EventEmitter = require("events");
class Network extends EventEmitter {}
const network = new Network();

module.exports = network;
```

### 2.7 client\gpu.js

```js
const EventEmitter = require("events");
class GPU extends EventEmitter {}
const gpu = new GPU();

module.exports = gpu;
```

### 2.8 client\main.js

```js
const EventEmitter = require("events");
class Main extends EventEmitter {}
const main = new Main();

module.exports = main;
```

## 3. 渲染流水线

1. 渲染进程把HTML转变为**DOM树**形结构
1. 渲染进程把CSS文本转为浏览器中的**styleSheet**
1. 通过 styesheet 计算出**DOM节点的样式**
1. 根据DOM树创建**布局树**
1. 并计算各个元素的**布局信息**
1. 根据布局树生成**分层树**
1. 根据分层树生成**绘制步骤**
1. 把绘制步骤交给渲染进程中的**合成线程**进行合成
1. 合成线程将图层分成**图块tile**
1. 合成线程会把分好的图块发给**栅格化线程池**，栅格化线程会把图快转化为**位图**
1. 而其实栅格化线程在工作的时候会把栅格化的工作交给**GPU进程**来完成，最终生成的位图久保存在**GPU内存**中
1. 当所有的图块都光栅化之后，合成线程会发送**绘制**图块的命令给浏览器主进程
1. 浏览器主进程然后会从GPU内存中取出位图**显示到页面**上

### 3.1 HTML转DOM树

* 浏览器中的HTML解析器可以把html字符串转换成DOM结构
* HTML解析器边接受网络数据边解析HTML
* 解析DOM
    * HTML字符串转**Token**
    * **Token栈**用来维护节点之间的父子关系，Token会依次压入栈中
    * 如果是**开始标签**，把Token压入栈中并且**创建新的DOM节点**并添加到父节点的children中
    * 如果是文本Token，则把**文本节点添加到栈顶元素的children**中，文本不需要入栈
    * 如果是**结束标签**，此开始标签**出栈**
    
#### 3.1.1 分词token

* html解析器将html字符串解析成DOM树形结构
* token栈

#### 3.1.2 client\request.js

* **htmlparser2** 解析html字符串，生成dom树
* top实现取栈顶元素的方法

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/aa81c52a15bc42e987cb053ec722254e~tplv-k3u1fbpfcp-watermark.image?)

* 当 content-type 为 text/html 时，使用html解析器开始解析
* 针对开始标签、文本节点、结束标签分别处理
* 开始标签
    * 取出栈顶元素作为parent
    * 将当前元素push进parent的children
    * 将当前元素push进token栈
* 文本节点
    * 过滤掉非空文本（如换行符回车空格）
    * 取出栈顶元素作为parent
    * 设置text后push进parent的children
* 结束标签
    * 出栈

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/d0dd2720e78e4eb88c01117f6018ea64~tplv-k3u1fbpfcp-watermark.image?)

##### **生成的DOM树**

```js
let document = {
  type: "document",
  children: [
    {
      type: "element",
      tagName: "html",
      children: [
        {
          type: "element",
          tagName: "body",
          children: [
            {
              type: "element",
              tagName: "div",
              children: [
                {
                  type: "text",
                  text: "hello",
                },
              ],
            },
            {
              type: "element",
              tagName: "div",
              children: [
                {
                  type: "text",
                  text: "world",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
```

### 3.2 CSS转stylesheet

-   渲染进程把CSS文本转为浏览器中的**stylesheet**
-   CSS来源可能有**link标签**、**style标签**和**style行内样式**
-   渲染引擎会把CSS转换为**document.styleSheets**

#### 3.2.1 server\public\index.html

* 设置div的color

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/88c4caa3aac14676ae9781d2767d342e~tplv-k3u1fbpfcp-watermark.image?)

#### 3.2.2 client/request.js

引入css解析器

```js
const css = require("css");
```

* 创建stylesheet
* 结束标签回调中，判断tagName为style，将内容push进stylesheet

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/b8693ae9d6864af6a12d8332bd478dc0~tplv-k3u1fbpfcp-watermark.image?)

* **打印cssRules**

```js
[
  {
    type: 'rule',
    selectors: [ 'div' ],
    declarations: [
      {
        type: 'declaration',
        property: 'color',
        value: 'red',
        position: Position {
          start: { line: 3, column: 9 },
          end: { line: 3, column: 19 },
          source: undefined
        }
      }
    ],
    position: Position {
      start: { line: 2, column: 7 },
      end: { line: 4, column: 8 },
      source: undefined
    }
  }
]
```

### 3.3 计算出DOM节点的样式

-   根据CSS的**继承和层叠规则**计算DOM节点的样式
-   DOM节点的样式保存在了**ComputedStyle**中

#### 3.3.1 server\public\index.html

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/2a40ff7db47942c8b5cc672aa55953e2~tplv-k3u1fbpfcp-watermark.image?)

#### 3.3.2 client/request.js

* 通过stylesheet计算出DOM节点的样式，将dom树、stylesheet传入
* 将css属性绑定到元素上
* 递归children

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/18fc47c471cf49b0b06484f3b6df3c39~tplv-k3u1fbpfcp-watermark.image?)

### 3.4 创建布局树

-   创建一棵只包含可见元素的布局树（过滤掉不可见元素）

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/484e3692ec324d6f92797f428d88e0e2~tplv-k3u1fbpfcp-watermark.image?)

#### 3.4.1 server\public\index.html

* display: none的元素，会被过滤，不会出现在布局树中

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/5eb76b7f84d44fae9db754d9145d56df~tplv-k3u1fbpfcp-watermark.image?)

#### 3.4.2 client\request.js

* 取出dom树中的body，对其进行处理
* 过滤掉不可见元素（此处以 display: none 为例，head、script标签也会被过滤不会出现在布局树中）
* 对子元素进行递归

![image.png](https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/d2393661c3cf4b84b17fd17c7757ea70~tplv-k3u1fbpfcp-watermark.image?)

### 3.5 计算布局

-   计算各个元素的布局

#### 3.5.1 client\request.js

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/8d64d03e36de4beeb85010ad99015892~tplv-k3u1fbpfcp-watermark.image?)

### 3.6 生成分层树

-   根据布局树生成分层树
-   渲染引擎需要为某些节点生成单独的图层，并组合成图层树
    -   z-index
    -   绝对定位和固定定位
    -   滤镜
    -   透明
    -   裁剪
-   这些图层合成最终的页面

#### 3.6.1 index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>浏览器渲染</title>
    <style>
      * {
        padding: 0;
        margin: 0;
      }
      #container {
        width: 100px;
        height: 100px;
      }
      .main {
        background: red;
      }
      #hello {
        background: green;
        width: 100px;
        height: 100px;
      }
      #world {
        background: blue;
        width: 100px;
        height: 100px;
      }
      #absolute {
        background: pink;
        width: 50px;
        height: 50px;
        left: 0px;
        top: 0px;
      }
    </style>
  </head>
  <body>
    <div id="container" class="main"></div>
    <div id="hello" style="color: blue">hello</div>
    <div id="world" style="display: none">world</div>
    <div id="absolute" style="position: absolute">abs</div>
  </body>
</html>
```

#### 3.6.2 client\request.js

* 初始化先将布局树作为一层
* 此处以 position: absolute 为例，遇到这种属性，重新计算布局，push进分层树数组
* 对children进行递归

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/652395c509834b85b956fd9c7c376d8a~tplv-k3u1fbpfcp-watermark.image?)

### 3.7 绘制

-   根据分层树进行生成绘制步骤复合图层
-   每个图层会拆分成多个绘制指令，这些指令组合在一起成为绘制列表

#### 3.7.1 client\request.js

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/753c04336bf046e486cc7a648964d6fe~tplv-k3u1fbpfcp-watermark.image?)

### 3.8 合成线程

-   合成线程将图层分成图块(tile)
-   合成线程会把分好的图块发给栅格化线程池，栅格化线程会把图片(tile)转化为位图
-   而其实栅格化线程在工作的时候会把栅格化的工作交给GPU进程来完成，最终生成的位图就保存在了`GPU`内存中
-   当所有的图块都光栅化之后合成线程会发送绘制图块的命令给浏览器主进程
-   浏览器主进程然后会从GPU内存中取出位图显示到页面上

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/f0fadf1bb4044c6ba4dd1f2a5a4fd881~tplv-k3u1fbpfcp-watermark.image?)

#### 3.8.1 图块

-   图块渲染也称基于瓦片渲染或基于小方块渲染
-   它是一种通过规则的网格细分计算机图形图像并分别渲染图块(tile)各部分的过程

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/ff682c9e3438407cb0fb128b3bdfd0e6~tplv-k3u1fbpfcp-watermark.image?)

#### 3.8.2 栅格化

-   栅格化是将矢量图形格式表示的图像转换成位图以用于显示器输出的过程
-   栅格即像素
-   栅格化即将矢量图形转化为位图(栅格图像)

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/ef96e7c90ad1491484e8b0d7b478dfc2~tplv-k3u1fbpfcp-watermark.image?)

#### 3.8.3 client\gpu.js

```js
const EventEmitter = require("events");
class GPU extends EventEmitter {
  constructor() {
    super();
    this.bitMaps = [];
  }
}
const gpu = new GPU();

module.exports = gpu;
```

#### 3.8.4 client\request.js

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/9e2f657ee32949fe942b2d906f582e0a~tplv-k3u1fbpfcp-watermark.image?)

* **栅格化线程**
* **图层**、**图块tile**、**位图**

![image.png](https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/7008ed4eea1041aca50120bb07269414~tplv-k3u1fbpfcp-watermark.image?)

### 3.9 资源加载

-   CSS加载不会影响DOM解析
-   CSS加载不会阻塞JS加载，但是会阻塞JS执行
-   JS会依赖CSS加载，JS会阻塞DOM解析

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/ffcd37b4e58d454faa2a9e760bea78b0~tplv-k3u1fbpfcp-watermark.image?)

* 创建loadingLinks、loadingScripts
* 正在加载的外链css文件、js文件会阻塞js执行
* 正在加载加载js文件会阻塞dom的解析

![image.png](https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/7e424041d9b3418395855e18053502c0~tplv-k3u1fbpfcp-watermark.image?)

使用 Promise.all 等待外链js的加载、解析

![image.png](https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/866b5640256c419fbe418adff42283d9~tplv-k3u1fbpfcp-watermark.image?)

> #### [完整项目地址](https://github.com/miracle90/browser-render)

<hr/>

> ### 相关问题
> * 什么是重排，重绘?
> * 怎样避免重排，重绘?
> * 什么是文档的预解析?(浏览器解析过程)
> * 说一下你对进程和线程的了解?区别？
> * 浏览器都有哪些进程，渲染进程中都有什么线程?


### <a id="reflow-repaint">1、什么是重排，重绘?</a>

#### **重排重绘**

当我们改变了一个元素的尺寸位置属性时，会重新进行样式计算(computed style)、布局(layout)、绘制(paint)以及后面的所有流程，这种行为称为重排。

当改变了某个元素的颜色属性时不会重新触发布局，但还是会触发样式计算和绘制，这种行为称为重绘。

我们可以发现重排和重绘都会占用主线程，还有 JS 也会运行在主线程，所以就会出现抢占执行时间的问题，如果你写了一个不断导致重排重绘的动画，浏览器则需要在每一帧都运行样式计算布局和绘制的操作。

#### **优化方式**

我们知道当前页面以每秒 60 帧的刷新率时才不会让用户感觉到页面卡顿，如果在运行动画是还有大量的 JS 任务需要执行，因为布局、绘制和 js 执行都是在主线程运行的，当在一帧的时间内布局和绘制结束后，还有剩余时间 js 就会拿到主线程的使用权，如果 js 执行时间过长，就会导致在下一帧开始时 js 没有及时归还主线程，导致下—帧动画没有按时渲染，就会出现页面的卡顿。

1. 第一种优化方式:

requestAnimationFrame，它会在每一帧被调用，通过回调 API 的回调，**可以把 js 运行任务分成一些更小的任务块，在每一帧事件用完前暂停 js 执行归还主线程**，这样的话在下一帧开始时，主线程就可以按时执行布局和绘制。

2. 第二种优化方式:

栅格化的整个流程不占用主线程，只在合成器线程和栅格线程中运行，这就意味着它无需和 js 抢占主线程。如果反复进行重绘和重排可能会导致掉帧，这是因为有可能 js 执行阻塞了主线程，而 CSS 中有个动画属性 transform，**通过该属性实现的动画不会经过布局和绘制，而是直接运行在合成器线程和栅格线程**，所以不会受到主线程中 js 执行的影响。更重要的是通过 transform 实现的动画由于不需要经过布局绘制样式计算等操作，所以节省了很多运算事件(方便实现负责的动画)

### <a id="avoid-reflow-repaint">2. 怎样避免重排，重绘?</a>

#### CSS 部分

* 使用transform替代 top等位移;
* 使用visibility替换display: none;
* 避免使用table布局;
* 尽可能在DOM树的最末端改变class;
* 避兔设置多层内联样式，尽量层级扁平;
* 将动画效果应用到position属性为absolute或fixed的元素上;
* 避免使用CSS表达式;
* 将频繁重绘或者回流的节点设置为图层，比如video，iframe;
* CSS3硬件加速(GPU加速)，可以是transform: translateZ(0)、opacity、filters、will-change
* Will-change提前告诉浏览器元素会发生什么变化;

#### JS 部分

* 避免频繁操作样式，合并操作;
* 避免频繁操作DOM，合并操作;
* 防抖节流控制频率;
* 避免频繁读取会引发回流/重绘的属性;
* 对具有复杂动画的元素使用绝对定位;

### <a id="document-pre-parse">3. 什么是文档的预解析?</a>

Webkit 和 Firefox 都做了这个优化，当执行 JavaScript 脚本时，另一个线程解析剩下的文档，并加载后面需要通过网络加载的资源。这种方式可以使资源并行加载从而使整体度更快。

需要注意的是，预解析并不改变 DOM 树，它将这个工作留给主解析过程，自己只解析外部资源的引用，比如外部脚本、样式表及图片。

### <a id="process-thread">4. 说一下你对进程和线程的了解?区别？</a>

**进程是资源分配的最小单位，线程是CPU调度的最小单位**

用户下达运行程序的命令时，就会产生进程。同一程序可产生多个进程(一对多的关系)，来允许同时有很多位用户运行同一程序，却不会相冲突。

进程需要一些资源才能完成的工作，如 cpu 使用时间、存储器、文件以及 I/O 设备，并且依照顺序逐一进行，也就是每个 CPU 核心任何时间内仅能运行一项进程。

* **一个进程可以包含多个线程** 进程是我们运行的程序代码和占用的资源总和，线程是进程的最小执行单位
* **不同进程间数据很难共享** 进程间需要通信的话，也需要一个公共环境或者一个媒介，这个就是操作系统
* **同一进程下不同线程间数据很易共享** 进程内的线程是共享进程资源的，处于同一地址空间，所以切换和通信相对成本小，而进程可以理解为没有公共的包裹容器
* **进程要比线程消耗更多的计算机资源**
* **进程间不会相互影响，一个线程挂掉将导致整个进程挂掉**
* **进程可以拓展到多机，进程最多适合多核**
*  **互斥锁** 进程使用的内存地址可以上锁，即一个线程使用某些共享内存时，其他线程必须等它结束，才能使用这一块内存
* **信号量** 进程使用的内存地址可以限定使用量

### <a id="browser-process">5. 浏览器都有哪些进程，渲染进程中都有什么线程?</a>

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/8a27a011332849828bd1342433a614b1~tplv-k3u1fbpfcp-watermark.image?)

#### 浏览器多进程的优势

相比于单进程浏览器，多进程有如下优点：

-   避免单个page crash影响整个浏览器
-   避免第三方插件crash影响整个浏览器
-   多进程充分利用多核优势
-   方便使用沙盒模型隔离插件等进程，提高浏览器稳定性

简单点理解：如果浏览器是单进程，那么某个Tab页崩溃了，就影响了整个浏览器，体验有多差；同理如果插件崩溃了也会影响整个浏览器；而且多进程还有其它的诸多优势。当然，多进程，内存等资源消耗也会更大，有点空间换时间的意思。

#### 浏览器进程

早期浏览器是单进程结构，由于单进程会导致卡死，容易奔溃等原因。现在浏览器就有了多进程架构，将来会是面向服务架构的。

每个页面或者同站点将分配一个渲染进程。渲染进程是由多个线程相互协同。

1. **浏览器主进程** 负责包括地址栏、书签栏、前进后退按钮等部分的工作
2. **渲染进程** 负责一个tab内关于网页呈现的所有事情
3. **GPU进程** 负责处理GPU相关的任务
4. **网络进程** 负责处理浏览器的一些不可见的底层操作，比如网络请求和文件访问
5. **其他插件进程** 负责控制一个网页用到的所有插件，如flash

#### 渲染进程中都有什么线程?

1. **GUI渲染线程**

    -   负责渲染浏览器界面、解析HTML、CSS、构建DOM树和RenderObeject树、布局和绘制等
    -   当界面需要重绘或由于某种操作引发回流时，该线程就会执行
    -   注意：GUI渲染线程和JS引擎线程是互斥的，JS引擎线优先级高于GUI渲染线程，当JS引擎执行时GUI线程会被挂起，GUI更新会保存在一个队列中等到JS引擎空闲时间立即被执行

2. **JS引擎线程**

    -   也称之为JS内核，负责处理和解析JavaScript脚本程序，运行代码，如V8引擎等;
    -   JS引擎一直等待这任务队列中的任务，然后加以处理，render进程中永远只有一个JS线程在运行js程序
    -   同样注意：GUI渲染线程和JS引擎线程是互斥的，JS执行时间过长，就会造成页面的渲染不连贯，导致页面渲染加载阻塞

3. **事件触发线程**

    -   归属于浏览器而不是JS引擎，用来控制事件循环；
    -   当JS引擎执行代码块如：setTimeout、鼠标点击、Ajax异步请求、会将对应的任务添加到事件线程中
    -   当对应的事件服务触发条件时，该线程会把事件添加到待处理队列的队尾，等到JS引擎来处理

4. **定时处理线程**

    -   setInterval与setTimeout所在的线程；
    -   浏览器定时计数器并不是由JavaScript引擎计数的，它是通过单独线程来计时并触发定时；
    -   注意：W3C在HTML标准中规定，要求setTimeout中低于4ms的时间间隔算为4ms

5. **异步http请求线程**

    -   在XMLHttpRequest连接后通过浏览器新开的一个线程请求
    -   将检测到状态变更时，如果设置有回调函数，异步线程就会产生状态变更事件，将这个回调在放入事件队列中，再由JavaScript引擎执行
    
    
#### 渲染进程中的线程之间的关系

##### 1. **GUI渲染线程与JS引擎线程互斥**

由于JavaScript是可操纵DOM的，如果在修改这些元素属性同时渲染界面（即JS线程和GUI线程同时运行），那么渲染线程前后获得的元素数据就可能不一致了。

因此为了防止渲染出现不可预期的结果，浏览器设置GUI渲染线程与JS引擎为互斥的关系，当JS引擎执行时GUI线程会被挂起，
GUI更新则会被保存在一个队列中等到JS引擎线程空闲时立即被执行。

##### 2. **JS阻塞页面加载**

从上述的互斥关系，可以推导出，JS如果执行时间过长就会阻塞页面。

譬如，假设JS引擎正在进行巨量的计算，所以JS引擎很可能很久很久后才能空闲，所以导致页面渲染加载阻塞。这就牵扯到script标签在html中的存放位置（为什么script标签一般放在body下面）。

#### js引擎是单线程的

我们知道js是单线程的。也就是说，同一个时间只能做一件事。那么，为什么JavaScript不能有多个线程呢？这样能提高效率啊。

-   JavaScript的单线程，与它的用途有关。作为浏览器脚本语言，JavaScript的主要用途是与用户互动，以及操作DOM。这决定了它只能是单线程，否则会带来很复杂的同步问题。比如，假定JavaScript同时有两个线程，一个线程在某个DOM节点上添加内容，另一个线程删除了这个节点，这时浏览器应该以哪个线程为准？
-   所以，为了避免复杂性，从一诞生，JavaScript就是单线程，这已经成了这门语言的核心特征，将来也不会改变。
-   为了利用多核CPU的计算能力，HTML5提出**Web Worker**标准，允许JavaScript脚本创建多个线程，但是子线程完全受主线程控制，且不得操作DOM。所以，这个新标准并没有改变JavaScript单线程的本质。

#### js事件轮询

上面我们已经知道JS引擎是单线程，任务应该是按顺序执行的，那么怎么会有同步异步之说？

-   单线程就意味着，所有任务需要排队，前一个任务结束，才会执行后一个任务。如果前一个任务耗时很长，后一个任务就不得不一直等着。
-   如果排队是因为计算量大，CPU忙不过来，倒也算了，但是很多时候CPU是闲着的，因为IO设备（输入输出设备）很慢（比如Ajax操作从网络读取数据），不得不等着结果出来，再往下执行。
-   JavaScript语言的设计者意识到，这时主线程完全可以不管IO设备，挂起处于等待中的任务，先运行排在后面的任务。等到IO设备返回了结果，再回过头，把挂起的任务继续执行下去。
-   于是，所有任务可以分成两种，一种是同步任务（synchronous），另一种是异步任务（asynchronous）。同步任务指的是，在**主线程**上排队执行的任务，只有前一个任务执行完毕，才能执行后一个任务；异步任务指的是，不进入主线程、而进入**任务队列**的任务，只有任务队列通知主线程，某个异步任务可以执行了，该任务才会进入主线程执行。

理解了同步异步。其实其最本质原因就是基于js的事件轮询机制。

1.  所有同步任务都在主线程（即js引擎线程）上执行，形成一个**执行栈**
1.  而异步任务均由**事件触发线程控制**，其有一个**任务队列**。只要异步任务有了运行结果，就在任务队列之中放置回调事件。异步任务必须指定回调函数，当主线程开始执行异步任务，就是执行对应的回调函数。所以所谓回调函数（callback），就是那些会被主线程挂起来的代码。
3.  一旦"执行栈"中的所有同步任务执行完毕，系统就会读取"任务队列"，按顺序结束等待状态，进入执行栈，开始执行。
1.  主线程不断重复上面的第三步
1.  只要主线程空了，就会去读取"任务队列"，这个过程会不断重复。这就是JavaScript的运行机制。又称为Event Loop（事件循环或者轮询）。

#### 定时器触发线程

> 为什么要单独的定时器线程？因为JavaScript引擎是单线程的, 如果处于阻塞线程状态就会影响记计时的准确，因此很有必要单独开一个线程用来计时。

上述事件循环机制的核心是：`JS引擎线程`和`事件触发线程`

js来控制主线程，事件触发来控制`任务队列就如主线程`。

什么时候会用到定时器线程？当使用setTimeout或setInterval时，它需要定时器线程计时

**计时完成后就会将特定的事件推入事件触发线程的任务队列中。等待进入主线程执行。**



