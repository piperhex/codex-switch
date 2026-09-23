# Legacy compatibility fixture

生产部署统一使用 [admin-go](../admin-go/README.md)。部署、更新和 Go 镜像回滚见
[部署文档](../admin-go/DEPLOYMENT.md)，功能与接口见 [参考文档](../admin-go/REFERENCE.md)。

本目录保留 NestJS 源码、DTO 和测试，用于提取原版接口契约并运行 Go/旧版对照测试。
原生产 Dockerfile、Compose 和 Kong 示例已移除，数据库升级脚本已迁至 `../admin-go/sql`。
对照环境由 `../admin-go/compose.test.yml` 和 `../admin-go/testdata/Dockerfile.legacy` 创建，
只使用本地模拟数据；准备和运行步骤见 [Go 对照测试](../admin-go/README.md#本地-docker-对照测试)。
