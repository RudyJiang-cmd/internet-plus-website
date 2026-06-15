# 腾讯云下线与恢复说明

## 静态网站

- GitHub Pages 由 `.github/workflows/pages.yml` 构建。
- Pages 构建固定设置 `VITE_AI_ENABLED=false`，不会请求 `/api/health` 或 `/api/generate`。
- 自定义域名由 `public/CNAME` 和 DNSPod 记录共同配置。

## Museformer 归档内容

完整归档必须包含：

- Linux 根文件系统压缩包，排除 `/dev`、`/proc`、`/sys`、`/run`、`/tmp` 和挂载目录。
- `/home/ubuntu/muzic` 下的模型权重、数据字典和代码。
- `museformer-api.service`、Python 包清单、系统包清单、CUDA/NVIDIA 信息和磁盘目录清单。
- 每个归档文件的 SHA-256 校验值。

插入至少有 150GB 空闲空间的加密 APFS 磁盘后执行：

```bash
./scripts/archive_museformer.sh /Volumes/加密磁盘/Lingyan-Cloud-Exit ./TRAE.pem
```

脚本在空间或磁盘加密条件不满足时会直接退出，不会产生不完整归档。

恢复时使用 Ubuntu 22.04 和 NVIDIA T4 或兼容 CUDA GPU，解压文件后恢复 systemd 服务，并以 `/health` 返回 `model_loaded: true` 作为验收条件。

## 销毁门槛

只有在以下条件全部满足后才销毁腾讯云资源：

1. 归档所在磁盘至少保留一份完整副本，并通过 `zstd -t`。
2. `SHA256SUMS` 全部校验通过，模型权重能够抽样读取。
3. GitHub Pages、`lingfun.fun` 和 HTTPS 已验证。
4. 腾讯云资源清单与账单已保存。
