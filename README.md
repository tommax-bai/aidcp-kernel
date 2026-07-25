# aidcp-kernel

aidcp 云端三服务（`aidcp-api` / `aidcp-automation` / `aidcp-content`）的**共享契约层**。
三个服务都合法依赖本仓；本仓**不依赖任何服务**。

## 准入门（AC-BOUND-03，比"看起来是纯的"更严）

kernel 文件 **MUST NOT** 出现：

1. SQL 字面量
2. HTTP / fetch
3. LLM / 供应商标识符（**包括 `LlmClient` / `ChatLlmClient` 这类名字本身**）
4. **模块级 `new Set` / `new Map`**（判为进程内活状态）

第 4 条踩过：很多"纯函数"文件因为一个模块级查表 `Set` 进不来，得先改成冻结数组。

## 来源

从 `aidcp-cloud` @ `41f2c73` 按 `boundaries/module-ownership.json` 裁定为 `kernel` 的文件切出。

## 状态

本仓是**为了止住副本漂移**而建：切仓第一刀时 kernel 被复制进了三个服务仓各一份，
必须收敛成单一来源。三个服务改为依赖本仓（git 依赖钉 sha）的接线**尚未完成**。

注意：三个服务当前编译不过的原因**不在本仓** —— 断掉的 import 没有一条指向 kernel，
全部指向别的服务层的业务文件。消解办法是「够格的提升进本仓」+「带行为的改注入接口」。
