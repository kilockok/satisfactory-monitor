# Satisfactory Server Monitor

一个轻量的 Satisfactory 专用服务器监控面板。轮询服务器 API，把 Tick Rate、在线玩家、游戏状态等信息实时展示在网页上。

历史数据以 JSONL 格式落盘，支持 1 小时到 90 天的时间范围查看。

## 功能

- Tick Rate / 玩家数 折线图（uPlot）
- 服务器状态、科技等级、游戏阶段等详情
- 数据每 30 秒自动刷新，秒级倒计时
- 历史数据持久化，重启不丢失

## 一键安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kilockok/satisfactory-monitor/main/install.sh)
```

需要 Node.js 20+，脚本会引导你配置服务器地址、密码和端口。

## 手动安装

```bash
git clone https://github.com/kilockok/satisfactory-monitor.git
cd satisfactory-monitor
cp .env.example .env   # 编辑填入你的服务器信息
pnpm install           # 或 npm install
node --env-file=.env server.js
```

打开 `http://你的IP:3000` 就能看到面板。
