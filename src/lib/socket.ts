import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents } from "../../shared/types";

// 同源连接；Vite 已将 /socket.io 代理到本地 :3001 后端
// socket.io-client 泛型顺序为 <ListenEvents, EmitEvents>，即 <服务端下发事件, 客户端上报事件>
export const socket: Socket<ServerEvents, ClientEvents> = io({
  autoConnect: false,
  transports: ["websocket", "polling"],
});
