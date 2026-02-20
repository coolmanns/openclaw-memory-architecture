/**
 * Searcher — Cross-session semantic retrieval via SQLite-vec.
 *
 * Extracted from Clint's archiveIndexer.js (search logic) +
 * knowledgeSystem.js (vec MATCH query pattern).
 *
 * Shares the same continuity.db as Indexer. Queries vec_exchanges
 * for semantically similar past exchanges, re-ranked with temporal
 * decay so newer exchanges about the same topic outrank older ones.
 *
 * Temporal ranking pattern adapted from Clint's intelligentRetrieval.js:
 * recencyBoost = exp(-ageInDays / halfLife) * weight
 */

class Searcher {
    /**
     * @param {object} config - full plugin config
     * @param {string} dataDir - plugin data directory
     * @param {object} db - shared better-sqlite3 database instance (from Indexer)
     */
    constructor(config = {}, dataDir, db) {
        this.db = db;
        this._embeddingFn = null;
        this._initialized = false;

        // Temporal ranking config
        this._recencyHalfLifeDays = config.search?.recencyHalfLifeDays || 14;
        this._recencyWeight = config.search?.recencyWeight || 0.15;
    }

    /**
     * Initialize embedding function for query generation.
     * If the Indexer has already been initialized, this shares its DB.
     * Otherwise, creates its own embedding pipeline.
     */
    async initialize() {
        if (this._initialized) return;

        // 1) Try llama.cpp embedding server (GPU-accelerated)
        const llamaUrl = process.env.LLAMA_EMBED_URL || 'http://localhost:8082';
        try {
            const http = require('http');
            const testPayload = JSON.stringify({ input: 'search_query: test', model: 'nomic-embed-text-v1.5' });
            const result = await new Promise((resolve, reject) => {
                const url = new URL(`${llamaUrl}/v1/embeddings`);
                const req = http.request({
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(testPayload) },
                    timeout: 5000,
                }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.write(testPayload);
                req.end();
            });

            if (result?.data?.[0]?.embedding?.length > 0) {
                this._embeddingFn = {
                    generate: async (texts) => {
                        // Use search_query prefix for retrieval queries
                        const prefixed = texts.map(t => t.startsWith('search_') ? t : `search_query: ${t}`);
                        const payload = JSON.stringify({ input: prefixed, model: 'nomic-embed-text-v1.5' });
                        return new Promise((resolve, reject) => {
                            const url = new URL(`${llamaUrl}/v1/embeddings`);
                            const req = http.request({
                                hostname: url.hostname,
                                port: url.port,
                                path: url.pathname,
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                                timeout: 30000,
                            }, (res) => {
                                let body = '';
                                res.on('data', chunk => body += chunk);
                                res.on('end', () => {
                                    try {
                                        const data = JSON.parse(body);
                                        resolve((data.data || []).map(d => d.embedding));
                                    } catch (e) { reject(e); }
                                });
                            });
                            req.on('error', reject);
                            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                            req.write(payload);
                            req.end();
                        });
                    }
                };
                this._initialized = true;
                console.log(`[Searcher] llama.cpp embedding server ready (${llamaUrl})`);
                return;
            }
        } catch (err) {
            console.warn(`[Searcher] llama.cpp not available: ${err.message}`);
        }

        // 2) Fallback: ONNX
        try {
            const { DefaultEmbeddingFunction } = require('@chroma-core/default-embed');
            this._embeddingFn = new DefaultEmbeddingFunction();
            await this._embeddingFn.generate(['warmup']);
            this._initialized = true;
            console.log('[Searcher] ONNX embedding ready — fallback');
        } catch {
            try {
                const { pipeline } = require('@huggingface/transformers');
                const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                this._embeddingFn = {
                    generate: async (texts) => {
                        const results = [];
                        for (const text of texts) {
                            const output = await pipe(text, { pooling: 'mean', normalize: true });
                            results.push(Array.from(output.data));
                        }
                        return results;
                    }
                };
                this._initialized = true;
            } catch (err) {
                console.error('[Searcher] No embedding model available:', err.message);
            }
        }
    }

    /**
     * Search for semantically similar exchanges with temporal re-ranking.
     *
     * 1. Fetch candidates from vec (semantic distance)
     * 2. Re-rank by blending distance with recency boost
     * 3. Sort by composite score (lower = better)
     *
     * @param {string} query - natural language search query
     * @param {number} [limit=5] - max results to return
     * @returns {{ exchanges: Array, distances: number[] }}
     */
    async search(query, limit = 5) {
        if (!this.db) {
            return { exchanges: [], distances: [], error: 'Database not available' };
        }

        if (!this._initialized) {
            await this.initialize();
        }

        if (!this._embeddingFn) {
            return { exchanges: [], distances: [], error: 'Embedding model not available' };
        }

        try {
            // Generate query embedding
            const embeddings = await this._embeddingFn.generate([query]);
            const queryEmbedding = embeddings?.[0];
            if (!queryEmbedding) {
                return { exchanges: [], distances: [], error: 'Failed to generate query embedding' };
            }

            // Fetch more candidates than needed — re-ranking may reorder them.
            // We fetch 2x limit so temporal boost can promote newer exchanges
            // that ranked slightly lower by pure semantic distance.
            const fetchLimit = Math.min(limit * 2, 60);

            const results = this.db.prepare(`
                SELECT
                    e.id,
                    e.combined,
                    e.user_text,
                    e.agent_text,
                    e.date,
                    e.exchange_index,
                    e.metadata,
                    e.created_at,
                    v.distance
                FROM vec_exchanges v
                JOIN exchanges e ON e.id = v.id
                WHERE v.embedding MATCH ?
                AND k = ?
                ORDER BY v.distance ASC
            `).all(new Float32Array(queryEmbedding), fetchLimit);

            // Re-rank with temporal decay
            const now = Date.now();
            const reranked = results.map(r => {
                const ageMs = now - this._parseTimestamp(r.date, r.exchange_index, r.created_at);
                const ageDays = ageMs / (1000 * 60 * 60 * 24);
                const recencyBoost = Math.exp(-ageDays / this._recencyHalfLifeDays) * this._recencyWeight;

                // Composite score: lower distance is better, higher recency is better.
                // Subtract recency boost from distance so newer exchanges score lower (better).
                const compositeScore = r.distance - recencyBoost;

                return {
                    id: r.id,
                    date: r.date,
                    exchangeIndex: r.exchange_index,
                    userText: r.user_text,
                    agentText: r.agent_text,
                    combined: r.combined,
                    metadata: this._parseMetadata(r.metadata),
                    distance: r.distance,
                    recencyBoost,
                    compositeScore
                };
            });

            // Sort by composite score (lower = more relevant + more recent)
            reranked.sort((a, b) => a.compositeScore - b.compositeScore);

            // Take the top results
            const top = reranked.slice(0, limit);

            return {
                exchanges: top,
                distances: top.map(r => r.distance)
            };
        } catch (error) {
            console.error('[Searcher] Search error:', error.message);
            return { exchanges: [], distances: [], error: error.message };
        }
    }

    /**
     * Format search results into a prompt-injectable block.
     * Results are sorted chronologically (oldest first) so the model
     * sees the natural progression of events — corrections appear
     * AFTER the original statements they correct.
     *
     * @param {{ exchanges: Array }} results - from search()
     * @param {number} [maxResults=3] - limit for prompt injection
     * @returns {string} formatted block or empty string
     */
    formatRetrieval(results, maxResults = 3) {
        if (!results?.exchanges || results.exchanges.length === 0) return '';

        const lines = ['[ARCHIVE RETRIEVAL]'];
        const items = results.exchanges.slice(0, maxResults);

        // Sort chronologically for display (oldest → newest)
        items.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return (a.exchangeIndex || 0) - (b.exchangeIndex || 0);
        });

        for (const ex of items) {
            lines.push(`[${ex.date}]`);
            if (ex.userText) lines.push(`  User: ${this._truncate(ex.userText, 300)}`);
            if (ex.agentText) lines.push(`  Agent: ${this._truncate(ex.agentText, 300)}`);
            lines.push('');
        }

        return lines.join('\n');
    }

    // ---------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------

    /**
     * Parse a timestamp from the exchange data.
     * Tries created_at first, then falls back to date + exchange_index.
     */
    _parseTimestamp(date, exchangeIndex, createdAt) {
        if (createdAt) {
            const ts = new Date(createdAt).getTime();
            if (!isNaN(ts)) return ts;
        }
        // Fallback: date string + exchange_index as fractional day position
        const ts = new Date(date + 'T12:00:00Z').getTime();
        if (!isNaN(ts)) return ts + (exchangeIndex || 0) * 60000;
        return Date.now(); // last resort — no boost
    }

    _parseMetadata(metadataStr) {
        try {
            return JSON.parse(metadataStr || '{}');
        } catch {
            return {};
        }
    }

    _truncate(text, maxLen) {
        if (!text || text.length <= maxLen) return text;
        return text.substring(0, maxLen - 3) + '...';
    }
}

module.exports = Searcher;
