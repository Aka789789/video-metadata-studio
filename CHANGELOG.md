# Changelog

All notable changes to this project are documented in this file.

## [1.0.4] - 2026-04-20

### Added

- 新增并完善仓库文档：`README.md`
- 新增版本变更记录文件：`CHANGELOG.md`

### Changed

- 发布脚本在发布完成后增加关键资产校验：`latest-mac.yml` 缺失时直接失败，避免发布“可下载但不可更新”的版本

## [1.0.3] - 2026-04-20

### Fixed

- 修复 mac 自动更新资产不完整导致更新检查失败的问题
- 优化发布流程，增强 Release 与 CI 结果可见性

## [1.0.2] - 2026-04-19

### Added

- 初步接入 GitHub Release 自动发布流程

### Known Issues

- 已出现 Release 资产为空的情况，导致缺少 `latest-mac.yml`，mac 客户端更新检查报 `404`

## [1.0.1] - 2026-04-19

### Changed

- 稳定性与打包流程小幅优化

## [1.0.0] - 2026-04-19

### Added

- 首个可用版本发布
- 支持批量视频处理、重写元数据、导出重命名
- 支持 1080x1920 规格化处理与导出后校验
