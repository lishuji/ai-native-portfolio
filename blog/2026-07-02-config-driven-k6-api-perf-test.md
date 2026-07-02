---
slug: config-driven-k6-api-perf-test
title: 从重复造轮子到零代码压测：我的 k6 性能测试实践
authors: [kanelli]
tags: [后端, 性能测试, k6, 测试工具]
keywords: [k6, API性能测试, 压力测试, 性能回归, 配置驱动, 负载测试]
---

一篇文章讲清两件事：k6 怎么用，以及怎么在它之上做一层配置驱动的封装，让「加接口压测」不用再写代码。

{/* truncate */}

## 目录

- [缘起：我受够了复制粘贴 k6 脚本](#缘起我受够了复制粘贴-k6-脚本)
- [一、k6 是什么](#一k6-是什么)
- [二、安装](#二安装)
- [三、第一个脚本](#三第一个脚本)
- [四、核心概念](#四核心概念)
- [五、三种测试类型](#五三种测试类型)
- [六、读懂 k6 的指标](#六读懂-k6-的指标)
- [七、进阶技巧](#七进阶技巧)
- [八、集成到 CI/CD](#八集成到-cicd)
- [九、实战：我做的配置驱动封装](#九实战我做的配置驱动封装)
- [十、实践建议](#十实践建议)
- [写在最后](#写在最后)

---

## 缘起：我受够了复制粘贴 k6 脚本

做后端这几年，性能测试一直让我别扭。

场景太熟悉了：某个接口线上偶尔慢，或者要上新功能怕扛不住流量，于是我打开 k6 写脚本。写完 `user-list` 的，过两天又要测 `order-create`，就把脚本复制一份，改改 URL、body、断言阈值……再过两天要测第三个接口，再复制一份。

结果项目里躺着七八个几乎一模一样的 `.js`，唯一区别就是几行请求参数。更糟的是，团队里其他人想加个接口测试，还得先看懂 k6 的 API、Trend、Rate、thresholds 这一套，门槛不低。

我想要的其实很简单：**测一个新接口，不该需要写代码，改个配置就行。**

于是就有了后面要讲的那套配置驱动封装。但在讲它之前，得先把 k6 本身说清楚——毕竟封装是站在 k6 的肩膀上。

## 一、k6 是什么

[k6](https://k6.io/) 是 Grafana Labs 出品的开源性能测试工具。它最大的特点是**面向开发者（developer-centric）**：

- **用 JavaScript 写测试脚本**，学习成本低，能像写代码一样版本化、复用、做逻辑判断
- **用 Go 实现引擎**，单机就能模拟大量并发，资源占用远低于同类工具
- **命令行原生**，天然适合 CI/CD，不依赖 GUI
- **指标体系完善**，内置延迟分位数、QPS、错误率等，还能自定义

一句话对比：如果说 JMeter 是「点鼠标配置」，k6 就是「写代码定义」。对开发者来说，后者更灵活、更好维护。

## 二、安装

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt install k6

# Windows
choco install k6

# Docker
docker pull grafana/k6
```

验证：`k6 version`

## 三、第一个脚本

k6 脚本的最小结构就三部分：**导入、配置、默认函数**。

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

// 1. 测试配置：10 个虚拟用户，跑 30 秒
export const options = {
  vus: 10,
  duration: '30s',
};

// 2. 每个虚拟用户循环执行的逻辑
export default function () {
  const res = http.get('https://test.k6.io');

  // 3. 断言
  check(res, {
    '状态码为 200': (r) => r.status === 200,
    '响应时间 < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1); // 模拟用户思考时间
}
```

运行：

```bash
k6 run script.js
```

k6 会启动 10 个 VU，每个 VU 反复执行 `default` 函数 30 秒，最后打印一份完整的指标报告。

## 四、核心概念

掌握下面这几个概念，就能看懂并写出绝大多数 k6 脚本。

### 1. VU（Virtual User，虚拟用户）

VU 是 k6 里施加负载的基本单位，代表一个「同时在发请求的用户」。每个 VU 是一个独立的执行线程，循环运行你的 `default` 函数。**并发数 = VU 数量。**

### 2. Iteration（迭代）

`default` 函数每执行一次叫一次迭代。总迭代数、每秒迭代数是衡量吞吐的重要指标。

### 3. Options（测试配置）

控制「怎么施加负载」，最常用两种模式：

**固定负载**——`vus` + `duration`：

```javascript
export const options = { vus: 50, duration: '1m' };
```

**阶梯负载**——`stages`，动态调整并发（做压力测试必备）：

```javascript
export const options = {
  stages: [
    { duration: '15s', target: 20 },   // 预热：0 → 20 VU
    { duration: '30s', target: 50 },   // 稳态：20 → 50 VU
    { duration: '30s', target: 100 },  // 加压：50 → 100 VU
    { duration: '15s', target: 0 },    // 冷却：100 → 0
  ],
};
```

`target` 是该阶段结束时要达到的 VU 数，k6 会在 `duration` 内线性爬升到这个值。这就是经典的「梯形加压」模型。

### 4. Checks（断言）

`check` 用于验证响应是否符合预期。**注意：check 失败不会中断测试**，只会记录失败率——这符合性能测试的语义（你要的是「有多少比例失败」，而不是「一失败就停」）。

```javascript
check(res, {
  '状态码 200': (r) => r.status === 200,
  '返回了数据': (r) => r.json('data') !== null,
});
```

### 5. Thresholds（阈值 / 通过标准）

Thresholds 是 k6 的**核心竞争力**——它定义「测试通过的标准」，不达标时 k6 进程会以非 0 退出码结束。这正是 CI/CD 性能门禁的基础。

```javascript
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // p95<500ms 且 p99<1s
    http_req_failed: ['rate<0.01'],                  // 错误率 < 1%
    checks: ['rate>0.99'],                           // 断言通过率 > 99%
  },
};
```

## 五、三种测试类型

同一套脚本，配上不同的负载模型（Options），就能覆盖不同的测试诉求。最常用的三种：

| 类型 | 典型耗时 | 负载特征 | 回答的问题 |
|------|---------|---------|-----------|
| **冒烟 Smoke** | ~15s | 极低并发、短时间 | 接口现在能用吗？基线性能正常吗？ |
| **压力 Stress** | ~1.5min | 并发逐步加压至系统吃不消 | 性能拐点在哪，撑到多少并发崩？ |
| **持久 Soak** | ~10min | 中等负载、长时间 | 有没有内存泄漏、连接池耗尽、性能衰减？ |

> 行业里还有 **负载测试（Load）** 模拟预期峰值流量、**尖刺测试（Spike）** 模拟流量瞬间暴涨，思路一致，只是负载曲线不同。

## 六、读懂 k6 的指标

跑完一次测试，k6 会输出一堆指标，重点认识这几个：

| 指标 | 含义 |
|------|------|
| `http_req_duration` | 请求总耗时（最关键，看 p95/p99 而非 avg） |
| `http_req_failed` | 请求失败率 |
| `http_reqs` | 总请求数 & QPS（`rate`） |
| `iterations` | 迭代总数 & 迭代速率 |
| `vus` / `vus_max` | 当前 / 峰值虚拟用户数 |
| `data_received/sent` | 收发流量 |

**为什么盯 p95/p99 而不是平均值？** 平均值会掩盖长尾：99 个请求 50ms、1 个请求 5s，平均才 100ms，但那个用户等了 5 秒。分位数才能反映真实的「最差体验」，长尾问题（GC、慢查询、锁竞争）通常藏在 p99 里。

`http_req_duration` 还能拆解成几段，帮你定位慢在哪：

- `http_req_blocked`：等待建连的时间
- `http_req_connecting`：TCP 建连
- `http_req_tls_handshaking`：TLS 握手
- `http_req_waiting`：**TTFB，等服务端处理的时间（这段大 = 后端慢）**
- `http_req_receiving`：接收响应体

## 七、进阶技巧

### 自定义指标

内置指标不够用时，可以自己定义 Trend（趋势）、Rate（比率）、Counter（计数）、Gauge（瞬时值）：

```javascript
import { Trend, Rate } from 'k6/metrics';

const myLatency = new Trend('api_duration');
const myErrors = new Rate('errors');

export default function () {
  const res = http.get('https://api.example.com/users');
  myLatency.add(res.timings.duration);
  myErrors.add(res.status !== 200);
}
```

### 参数化与环境变量

用 `-e` 传参，脚本里用 `__ENV` 读取，实现一套脚本多环境复用：

```bash
k6 run -e BASE_URL=https://staging.example.com -e TOKEN=xxx script.js
```

```javascript
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
```

### 读取外部数据文件

用 `open()` 加载 JSON/CSV，做数据驱动测试：

```javascript
const users = JSON.parse(open('./users.json'));
```

### 生命周期钩子

k6 脚本有四个执行阶段，可用于准备/清理数据：

```javascript
export function setup() { /* 测试前跑一次，返回值传给 default */ }
export default function (data) { /* 每个 VU 反复执行 */ }
export function teardown(data) { /* 测试后跑一次 */ }
```

### 结果导出

```bash
# 导出汇总 JSON（可用于前后对比）
k6 run --summary-export=result.json script.js

# 输出到时序数据库做可视化
k6 run --out influxdb=http://localhost:8086/k6 script.js
```

## 八、集成到 CI/CD

k6 「不达阈值就非 0 退出」的特性，让它天然适合当性能门禁：

```yaml
name: API Performance Gate
on: [push]
jobs:
  perf-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - name: Run k6 test
        run: k6 run test/smoke.js
        # thresholds 不达标 → 退出码非 0 → 流水线失败
```

## 九、实战：我做的配置驱动封装

回到开头的痛点——每个接口都手写一份 k6 脚本很快就会难以维护。我的解法是在 k6 之上做一层**配置驱动**的封装：把接口定义抽到一个 JSON 里，实现「加接口零代码」。

### 1. 用一个 JSON 管住所有接口

```json
{
  "global": {
    "baseUrl": "https://api.example.com",
    "token": "your-jwt-token",
    "thresholds": { "p95": 500, "p99": 1000, "errorRate": 1 }
  },
  "apis": {
    "user-list": {
      "name": "用户列表",
      "path": "/api/v1/users",
      "method": "GET",
      "query": { "page": 1, "size": 20 },
      "checkField": "data.list"
    },
    "user-search": {
      "name": "用户搜索",
      "path": "/api/v1/users/search",
      "method": "POST",
      "body": { "keyword": "test" },
      "thresholds": { "p95": 300 }
    }
  }
}
```

关键设计是**接口级配置自动继承并覆盖全局配置**：`user-search` 只声明了更严的 `p95: 300`，其余的 `p99`、`baseUrl`、`token` 全部继承 `global`。优先级为 **环境变量 > 接口级 > 全局**，切环境时一个 `BASE_URL=xxx` 前缀就能临时覆盖，对 CI 友好。

### 2. 三档测试，一条命令

```bash
# 列出配置里所有接口
./scripts/run.sh list config/my-apis.json

# 冒烟测试（~15s，快速验证接口可用）
./scripts/run.sh smoke  config/my-apis.json user-list

# 压力测试（~1.5min，梯形加压找拐点）
./scripts/run.sh stress config/my-apis.json user-list

# 持久测试（~10min，查内存泄漏）
./scripts/run.sh soak   config/my-apis.json user-list
```

底层其实就是把参数拼成 `-e` 传给 k6：

```bash
k6 run -e CONFIG_FILE=config/my-apis.json -e API_ID=user-list test/stress.js
```

### 3. 环境变量临时覆盖

不改配置文件，用环境变量前缀就能切环境、调阈值：

```bash
# 切到 staging 环境
BASE_URL=https://staging.example.com ./scripts/run.sh smoke config/my-apis.json user-list

# 自定义加压曲线
k6 run -e CONFIG_FILE=config/my-apis.json -e API_ID=user-list \
  -e 'STAGES=[{"duration":"10s","target":200},{"duration":"30s","target":500}]' test/stress.js
```

### 4. 新增一个接口：只加 JSON，不写代码

```json
"order-create": {
  "name": "创建订单",
  "path": "/api/v1/orders",
  "method": "POST",
  "body": { "productId": "123", "quantity": 1 },
  "checkField": "data.orderId"
}
```

```bash
./scripts/run.sh stress config/my-apis.json order-create
```

全程不碰任何 k6 脚本，团队里谁都能加——这正是开头那个「加接口零代码」诉求的落地。

### 5. 性能回归对比

性能优化最怕「我觉得快了」。所以我还写了个对比脚本：优化前后各跑一次、导出结果，再一键生成人话报告：

```bash
# 优化前
./scripts/run.sh stress config/my-apis.json user-list --summary-export=results/before.json
# 优化后
./scripts/run.sh stress config/my-apis.json user-list --summary-export=results/after.json
# 生成报告
node scripts/compare.js
```

```
平均延迟   771.6ms → 320.5ms   ↓58.5% ✅
p95 延迟  1770.0ms → 650.3ms   ↓63.3% ✅
QPS         52.5/s → 128.3/s   ↑144.4% ✅

🎉 结论: 性能有明显提升！
```

延迟越低越好、QPS 越高越好，脚本自动判断方向并给结论。做完优化把它贴到 MR 里，非常有说服力。

## 十、实践建议

1. **先冒烟再加压**：低并发跑通脚本逻辑，再逐步加大负载，别一上来就打满
2. **加 sleep 模拟真实用户**：真实用户不会毫无间隔地狂点，`sleep()` 让压力更贴近实际
3. **环境要接近生产**：数据量、机器配置、网络都会显著影响结果
4. **一次只改一个变量**：否则分不清是哪个改动带来的性能变化
5. **务必设 thresholds**：没有通过标准的性能测试只是「跑了个数字」，无法自动判断好坏
6. **别对生产随意压测**：注意隔离、限流，避免影响真实用户

## 写在最后

k6 把性能测试从「配置工具」变成了「写代码」，对开发者极其友好：脚本能进 Git、能复用、能塞进 CI。掌握 VU、stages、checks、thresholds 这四个核心概念，再看懂 p95/p99 这些指标，就能覆盖日常绝大多数的性能测试需求。

而在它之上再做一层配置驱动的封装，就能把「加接口零代码」「性能回归对比」也一并收进日常工作流。回头看，这个封装不大、代码很克制，但它实实在在解决了我自己的两个痛点：**加接口不用写代码**，**优化效果有据可查**。

有时候好用的工具不需要多复杂——把重复的部分抽走、把有用的数字亮出来，就够了。

---

*参考：[k6 官方文档](https://grafana.com/docs/k6/latest/) · 技术栈：k6 · Node.js · Bash*
