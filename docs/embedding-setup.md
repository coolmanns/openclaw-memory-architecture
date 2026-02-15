# Embedding Setup Guide

## Option 1: Local with Ollama (Recommended)

### Install and pull the model

```bash
# If Ollama is running natively
ollama pull nomic-embed-text

# If Ollama is in Docker
docker exec ollama ollama pull nomic-embed-text
```

### Pin in VRAM (optional, saves cold-start latency)

```bash
# Load with infinite keep-alive (stays in VRAM until explicitly unloaded)
curl -s http://localhost:11434/api/generate \
  -d '{"model":"nomic-embed-text","keep_alive":-1,"prompt":"warmup"}' > /dev/null
```

### Configure OpenClaw

Add to your `openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": {
          "baseUrl": "http://localhost:11434/v1",
          "apiKey": "ollama"
        },
        "model": "nomic-embed-text",
        "fallback": "none"
      }
    }
  }
}
```

**Note:** We use `provider: "openai"` because Ollama exposes an OpenAI-compatible API at `/v1`. This isn't actually calling OpenAI.

### Resource usage

- **Disk:** 274MB
- **VRAM:** 577MB when loaded
- **Latency:** ~61ms warm, ~3s cold
- **Dimensions:** 768

## Option 2: QMD (OpenClaw Built-in)

QMD is included with OpenClaw and uses its own embedded models:

- **embeddinggemma-300M** for vector embeddings
- **qwen3-reranker-0.6b** for result reranking
- **Qwen3-0.6B** for query expansion

### Configure

```json
{
  "memorySearch": {
    "backend": "qmd",
    "qmd": {
      "includeDefaultMemory": true,
      "limits": {
        "maxResults": 6,
        "timeoutMs": 5000
      }
    }
  }
}
```

### Tradeoffs

- ✅ Best result quality (reranking + query expansion)
- ✅ Zero external dependencies
- ⚠️ 3 models compete for VRAM (~1.5GB total)
- ⚠️ ~4s latency per query (all 3 models run sequentially)

### Recommended: QMD primary + Ollama fallback

Use QMD for reranked quality, fall back to Ollama when QMD times out:

```json
{
  "memorySearch": {
    "backend": "qmd",
    "qmd": {
      "limits": { "timeoutMs": 5000 }
    }
  },
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": {
          "baseUrl": "http://localhost:11434/v1",
          "apiKey": "ollama"
        },
        "model": "nomic-embed-text",
        "fallback": "none"
      }
    }
  }
}
```

## Option 3: OpenAI Cloud

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "model": "text-embedding-3-small"
      }
    }
  }
}
```

Requires `OPENAI_API_KEY` in environment. Cost: ~$0.02 per million tokens.

## Switching Models

⚠️ **Changing embedding models requires re-indexing.** Different models produce different vector dimensions (nomic = 768d, OpenAI = 1536d). Existing embeddings are incompatible with a new model.

To force re-index with QMD:
```bash
qmd update --force -c memory-root
```
