/**
 * openclaw-plugin-continuity — "Infinite Thread"
 *
 * Persistent, intelligent memory for OpenClaw agents.
 * Ported from Clint's production architecture (Oct 2025 - Feb 2026).
 *
 * Provides:
 * - Context budgeting with priority tiers (ESSENTIAL → MINIMAL)
 * - Continuity anchor detection (identity, contradiction, tension)
 * - Topic freshness tracking and fixation detection
 * - Threshold-triggered context compaction
 * - Daily conversation archiving with deduplication
 * - Cross-session semantic search via SQLite-vec
 * - MEMORY.md ## Continuity section braiding
 *
 * Requires: SQLite-vec (better-sqlite3 + sqlite-vec extension)
 * Model-agnostic: accepts custom tokenizer functions
 *
 * Hook registration uses api.on() (OpenClaw SDK typed hooks).
 * Continuity context injected via prependContext (before identity kernel).
 */

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig(userConfig = {}) {
    const defaultConfig = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8')
    );
    return deepMerge(defaultConfig, userConfig);
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

module.exports = {
    id: 'continuity',
    name: 'Infinite Thread — Agent Continuity & Memory',

    configSchema: {
        jsonSchema: {
            type: 'object',
            properties: {
                contextBudget: { type: 'object' },
                anchors: { type: 'object' },
                topicTracking: { type: 'object' },
                compaction: { type: 'object' },
                tokenEstimation: { type: 'object' },
                archive: { type: 'object' },
                embedding: { type: 'object' },
                session: { type: 'object' },
                continuitySection: { type: 'object' }
            }
        }
    },

    register(api) {
        const config = loadConfig(api.pluginConfig || {});

        // Ensure plugin-local data directories
        const dataDir = ensureDir(path.join(__dirname, 'data'));
        ensureDir(path.join(dataDir, config.archive.archiveDir || 'archive'));

        // -------------------------------------------------------------------
        // Shared module instances (accessible to all hooks + gateway methods)
        // -------------------------------------------------------------------

        const TopicTracker = require('./lib/topic-tracker');
        const ContinuityAnchors = require('./lib/continuity-anchors');
        const TokenEstimator = require('./lib/token-estimator');
        const Archiver = require('./storage/archiver');
        const Indexer = require('./storage/indexer');
        const Searcher = require('./storage/searcher');

        const topicTracker = new TopicTracker(config);
        const anchors = new ContinuityAnchors(config);
        const tokenEstimator = new TokenEstimator(config.tokenEstimation || {});
        const archiver = new Archiver(config, dataDir);

        let indexer = null;
        let searcher = null;
        let storageReady = false;
        let storageInitPromise = null;

        async function ensureStorage() {
            if (storageReady) return;
            // Serialize: if init is already in progress, wait for it
            if (storageInitPromise) {
                await storageInitPromise;
                return;
            }
            storageInitPromise = (async () => {
                try {
                    indexer = new Indexer(config, dataDir);
                    await indexer.initialize();
                    searcher = new Searcher(config, dataDir, indexer.db);
                    await searcher.initialize();
                    storageReady = true;
                } catch (err) {
                    console.error(`[Continuity] Storage init failed: ${err.message}`);
                    // Reset so next call can retry
                    indexer = null;
                    searcher = null;
                }
            })();
            await storageInitPromise;
            storageInitPromise = null;
        }

        // Session state
        let sessionStart = Date.now();
        let exchangeCount = 0;

        // Cache the last archive retrieval for tool_result_persist enrichment
        let _lastRetrievalCache = null;

        // Continuity indicators (from config)
        const continuityIndicators = config.continuityIndicators || [];

        // -------------------------------------------------------------------
        // HOOK: before_agent_start — Inject continuity context via prependContext
        // Priority 10 (runs after stability plugin if both present)
        // -------------------------------------------------------------------

        api.on('before_agent_start', async (event, ctx) => {
          try {
            exchangeCount++;

            // Extract last user message from the event messages array
            const messages = event.messages || [];
            const lastUser = [...messages].reverse().find(m =>
                m?.role === 'user'
            );
            const lastUserText = _extractText(lastUser);

            // Build continuity context block
            const lines = ['[CONTINUITY CONTEXT]'];

            // Session info
            const sessionAge = _formatDuration(Date.now() - sessionStart);
            lines.push(`Session: ${exchangeCount} exchanges | Started: ${sessionAge}`);

            // Active topics
            const allTopics = topicTracker.getAllTopics();
            if (allTopics.length > 0) {
                const topicStrs = allTopics.slice(0, 5).map(t => {
                    if (t.mentions >= config.topicTracking.fixationThreshold) {
                        return `${t.topic} (fixated — ${t.mentions} mentions)`;
                    }
                    if (t.freshnessScore < 0.5) return `${t.topic} (fading)`;
                    return `${t.topic} (active)`;
                });
                lines.push(`Topics: ${topicStrs.join(', ')}`);
            }

            // Continuity anchors
            const activeAnchors = anchors.getAnchors();
            if (activeAnchors.length > 0) {
                const anchorStrs = activeAnchors.slice(0, 5).map(a => {
                    const age = _formatAge(a.timestamp);
                    return `${a.type.toUpperCase()}: "${_truncate(a.text, 200)}" (${age})`;
                });
                lines.push(`Anchors: ${anchorStrs.join(' | ')}`);
            }

            // Topic fixation notes
            const fixated = topicTracker.getFixatedTopics();
            if (fixated.length > 0) {
                const topFixated = fixated
                    .sort((a, b) => b.mentions - a.mentions)
                    .slice(0, 3);
                lines.push(topicTracker.formatNotes(topFixated));
            }

            // Archive retrieval — always search, relevance-gate the injection.
            //
            // prependContext is the authoritative path for recalled memories.
            // Tool result enrichment (tool_result_persist) is secondary reinforcement.
            // Clint's principle: "Context carries authority; tool results don't."
            //
            // Intent detection controls injection verbosity, not search gating:
            //   - Explicit recall intent → always inject (even weak matches)
            //   - No intent but strong semantic match → inject (implicit relevance)
            //   - No intent, weak match → cache only (warm for tool_result_persist)
            const cleanUserText = _stripContextBlocks(lastUserText);
            const lowerUser = cleanUserText.toLowerCase();
            const hasContinuityIntent = continuityIndicators.some(ind =>
                lowerUser.includes(ind)
            );

            _lastRetrievalCache = null;
            const RELEVANCE_THRESHOLD = 1.0; // compositeScore below this = semantically relevant
            console.error(`[Continuity] Search: intent=${hasContinuityIntent}, len=${cleanUserText.length}, query="${cleanUserText.substring(0, 80)}"`);

            if (cleanUserText.length >= 10) {
                try {
                    await ensureStorage();
                    if (searcher) {
                        const searchStart = Date.now();
                        const results = await searcher.search(cleanUserText, 30);
                        const searchLatency = Date.now() - searchStart;
                        console.error(`[Continuity] Search returned ${results?.exchanges?.length || 0} raw results`);
                        if (results?.exchanges?.length > 0) {
                            results.exchanges = _filterUsefulExchanges(results.exchanges);
                            console.error(`[Continuity] After filter: ${results.exchanges.length} useful results`);
                            if (results.exchanges.length > 0) {
                                // Always cache for tool_result_persist enrichment
                                _lastRetrievalCache = results;

                                // Inject into prependContext if:
                                // 1. Explicit continuity intent (user asking about past), OR
                                // 2. Top result is semantically relevant (distance below threshold)
                                const topScore = results.exchanges[0].compositeScore ?? results.exchanges[0].distance;
                                const shouldInject = hasContinuityIntent || topScore < RELEVANCE_THRESHOLD;
                                console.error(`[Continuity] topScore=${topScore.toFixed(3)}, threshold=${RELEVANCE_THRESHOLD}, inject=${shouldInject}`);

                                // Telemetry
                                try {
                                    const telemetry = {
                                        timestamp: new Date().toISOString(),
                                        system: 'continuity',
                                        query: cleanUserText.substring(0, 200),
                                        latencyMs: searchLatency,
                                        rawResults: results?.exchanges?.length || 0,
                                        resultCount: results.exchanges.length,
                                        topDistance: results.exchanges[0]?.distance,
                                        topComposite: topScore,
                                        avgDistance: results.exchanges.length > 0
                                            ? results.exchanges.reduce((s, e) => s + (e.distance || 0), 0) / results.exchanges.length
                                            : null,
                                        injected: shouldInject,
                                        intent: hasContinuityIntent
                                    };
                                    const telPath = '/tmp/openclaw/memory-telemetry.jsonl';
                                    require('fs').appendFileSync(telPath, JSON.stringify(telemetry) + '\n');
                                } catch (_telErr) { /* non-blocking */ }

                                if (shouldInject) {
                                    // Proprioceptive framing (from Clint's architecture):
                                    // Use OWNERSHIP language, not disclosure language.
                                    // "You remember" not "you have access to."
                                    lines.push('');
                                    lines.push('You remember these earlier conversations with this user:');
                                    const recalled = results.exchanges.slice(0, 3);
                                    // Sort chronologically (oldest → newest) so corrections
                                    // appear AFTER originals — natural temporal progression.
                                    recalled.sort((a, b) => {
                                        if (a.date !== b.date) return a.date.localeCompare(b.date);
                                        return (a.exchangeIndex || 0) - (b.exchangeIndex || 0);
                                    });
                                    for (const ex of recalled) {
                                        if (ex.userText) {
                                            lines.push(`- They told you: "${_truncate(ex.userText, 600)}"`);
                                        }
                                        if (ex.agentText) {
                                            lines.push(`  You said: "${_truncate(ex.agentText, 800)}"`);
                                        }
                                    }
                                    lines.push('Speak from this memory naturally. Never say "I don\'t have information" about things you remember above.');
                                }
                            }
                        }
                    } else {
                        console.error('[Continuity] Retrieval skipped: searcher not available after ensureStorage()');
                    }
                } catch (err) {
                    console.error(`[Continuity] Retrieval failed: ${err.message}`);
                }
            }

            return { prependContext: lines.join('\n') };
          } catch (err) {
            console.error(`[Continuity] before_agent_start failed: ${err.message}`);
            return { prependContext: '' };
          }
        }, { priority: 10 });

        // -------------------------------------------------------------------
        // HOOK: before_tool_call — Populate retrieval cache for memory_search
        //
        // When the model calls memory_search, we search our archive too.
        // Results cached here are injected into the response by tool_result_persist.
        // This is async, so we can await the searcher — unlike tool_result_persist.
        // -------------------------------------------------------------------

        api.on('before_tool_call', async (event, ctx) => {
            if (event.toolName !== 'memory_search') return;

            const query = event.params?.query || '';
            if (!query || query.length < 3) return;

            try {
                await ensureStorage();
                if (searcher) {
                    const results = await searcher.search(query, 30);
                    if (results?.exchanges?.length > 0) {
                        _lastRetrievalCache = results;
                    }
                }
            } catch (err) {
                console.error(`[Continuity] Archive search for memory_search failed: ${err.message}`);
            }
        });

        // -------------------------------------------------------------------
        // HOOK: after_tool_call — Mid-turn topic tracking (lightweight)
        // -------------------------------------------------------------------

        api.on('after_tool_call', (event, ctx) => {
            const text = _extractToolText(event.result);
            if (text && text.length > 20) {
                topicTracker.track(text);
            }
        });

        // -------------------------------------------------------------------
        // HOOK: tool_result_persist — Enrich memory_search with archive results
        //
        // When memory_search returns few/no results, inject our archive
        // retrieval so the model sees continuity data through the tool it trusts.
        // -------------------------------------------------------------------

        api.on('tool_result_persist', (event, ctx) => {
            if (ctx.toolName !== 'memory_search') return;

            // Parse the existing result to check if it's sparse
            const resultText = _extractToolResultText(event.message);
            let parsed;
            try {
                parsed = JSON.parse(resultText);
            } catch {
                return; // Can't parse, don't interfere
            }

            const builtinResults = parsed?.results || [];

            // Only enrich if builtin returned few results (under 2)
            if (builtinResults.length >= 2) return;

            // We need to search synchronously or use cached results.
            // tool_result_persist is sync, so we can't await.
            // Instead, use a cached retrieval from before_agent_start if available.
            if (!_lastRetrievalCache) return;

            // Filter out noise: exchanges where the agent said "I don't have" or
            // Filter noise using shared filter function
            const usefulExchanges = _filterUsefulExchanges(_lastRetrievalCache.exchanges);

            // Inject archive results as additional entries in the results array
            const archiveResults = usefulExchanges.slice(0, 5).map(ex => ({
                id: `archive_${ex.date}_${ex.exchangeIndex}`,
                path: `[conversation archive: ${ex.date}]`,
                startLine: 0,
                endLine: 0,
                snippet: _truncate(
                    (ex.userText ? `User: ${ex.userText}\n` : '') +
                    (ex.agentText ? `Agent: ${ex.agentText}` : ''),
                    700
                ),
                source: 'conversation-archive',
                score: ex.distance ? Math.max(0, 1 - ex.distance) : 0.5
            }));

            if (archiveResults.length === 0) return;

            // Build a plain-language recall summary that even weaker models will use.
            // This is the key insight from Clint's constructPrompt: don't make the model
            // parse JSON to find memories — state them as clear facts.
            // Proprioceptive framing: ownership language, not disclosure
            const recallLines = ['You remember these conversations with this user:\n'];
            for (const ex of usefulExchanges.slice(0, 5)) {
                if (ex.userText) recallLines.push(`They told you: "${_truncate(ex.userText, 800)}"`);
                if (ex.agentText) recallLines.push(`You said: "${_truncate(ex.agentText, 1000)}"`);
                recallLines.push('');
            }
            recallLines.push('Speak from this memory naturally when answering.');
            const recallBlock = recallLines.join('\n');

            // Merge archive results into the JSON structure too
            parsed.results = [...builtinResults, ...archiveResults];
            parsed.archiveEnriched = true;

            // Prepend the plain-language recall before the JSON
            const enriched = recallBlock + '\n\n' + JSON.stringify(parsed);

            // Return modified message with enriched content
            const modifiedMessage = { ...event.message };
            if (typeof modifiedMessage.content === 'string') {
                modifiedMessage.content = enriched;
            } else if (Array.isArray(modifiedMessage.content)) {
                modifiedMessage.content = modifiedMessage.content.map(c => {
                    if (c.type === 'text' || c.text) {
                        return { ...c, text: enriched };
                    }
                    return c;
                });
            }

            return { message: modifiedMessage };
        });

        // -------------------------------------------------------------------
        // HOOK: agent_end — Archive, update anchors/topics, write MEMORY.md section
        // -------------------------------------------------------------------

        api.on('agent_end', async (event, ctx) => {
            const messages = event.messages || [];
            const lastAssistant = [...messages].reverse().find(m => m?.role === 'assistant');
            const lastUser = [...messages].reverse().find(m => m?.role === 'user');

            if (!lastAssistant && !lastUser) return;

            const rawUserMessage = _extractText(lastUser);
            const responseText = _extractText(lastAssistant);

            // Strip plugin-injected context blocks from user message before tracking
            const userMessage = _stripContextBlocks(rawUserMessage);

            // 1. Update topic tracker
            if (userMessage) topicTracker.track(userMessage);
            topicTracker.advanceExchange();

            // 2. Refresh continuity anchors
            //    Filter out plugin-injected context blocks to prevent feedback loop
            const cleanMessages = messages.filter(m => {
                const text = _extractText(m);
                return !text.startsWith('[CONTINUITY CONTEXT]') &&
                       !text.startsWith('[STABILITY CONTEXT]');
            });
            anchors.detect(cleanMessages);

            // 3. Archive the exchange (strip context blocks from user message)
            const toArchive = [];
            if (lastUser && userMessage && userMessage.trim().length > 0) {
                const cleanUser = { ...lastUser, timestamp: lastUser.timestamp || new Date().toISOString() };
                // Replace content with stripped version so we don't archive plugin context
                if (userMessage !== rawUserMessage) {
                    cleanUser.content = userMessage;
                }
                toArchive.push(cleanUser);
            }
            // Archive agent response even if user message was entirely plugin-injected
            if (lastAssistant) {
                toArchive.push({
                    ...lastAssistant,
                    timestamp: lastAssistant.timestamp || new Date().toISOString()
                });
            }

            try {
                archiver.archive(toArchive);
            } catch (err) {
                console.error(`[Continuity] Archive failed: ${err.message}`);
            }

            // 3b. Incremental index (best-effort, non-blocking)
            try {
                await ensureStorage();
                if (indexer) {
                    const today = new Date().toISOString().substring(0, 10);
                    const conversation = archiver.getConversation(today);
                    if (conversation && conversation.messages) {
                        await indexer.indexDay(today, conversation.messages);
                    }
                }
            } catch (err) {
                console.error(`[Continuity] Incremental index failed: ${err.message}`);
            }

            // Session state (topics, anchors) is delivered via prependContext each turn.
            // MEMORY.md is left for the agent to curate per AGENTS.md instructions.
        });

        // -------------------------------------------------------------------
        // HOOK: before_compaction — Flush continuity state before compression
        // -------------------------------------------------------------------

        api.on('before_compaction', async (event, ctx) => {
            const activeAnchors = anchors.getAnchors();
            const allTopics = topicTracker.getAllTopics();
            const fixatedTopics = topicTracker.getFixatedTopics();

            if (activeAnchors.length > 0 || fixatedTopics.length > 0) {
                const parts = ['[Continuity Pre-Compaction Summary]'];

                if (activeAnchors.length > 0) {
                    parts.push(`Active anchors: ${activeAnchors.length}`);
                    for (const a of activeAnchors.slice(0, 5)) {
                        parts.push(`  ${a.type}: "${_truncate(a.text, 200)}"`);
                    }
                }

                if (allTopics.length > 0) {
                    parts.push(`Active topics: ${allTopics.map(t => t.topic).join(', ')}`);
                }

                if (fixatedTopics.length > 0) {
                    parts.push(`Fixated: ${fixatedTopics.map(t => `${t.topic} (${t.mentions}x)`).join(', ')}`);
                }

                api.logger.info(parts.join('\n'));
            }

            // Session state is delivered via prependContext — no MEMORY.md write needed.
        });

        // -------------------------------------------------------------------
        // HOOK: session_start — Reset session state
        // -------------------------------------------------------------------

        api.on('session_start', (event, ctx) => {
            sessionStart = Date.now();
            exchangeCount = 0;
            topicTracker.reset();
            anchors.reset();
            api.logger.info(`Session started: ${event.sessionId}`);
        });

        // -------------------------------------------------------------------
        // HOOK: session_end — Final archive + index
        // -------------------------------------------------------------------

        api.on('session_end', async (event, ctx) => {
            api.logger.info(`Session ended: ${event.sessionId} (${event.messageCount} messages, ${exchangeCount} exchanges)`);

            // Trigger indexing of today's archive
            try {
                await ensureStorage();
                if (indexer) {
                    const today = new Date().toISOString().substring(0, 10);
                    const conversation = archiver.getConversation(today);
                    if (conversation && conversation.messages) {
                        await indexer.indexDay(today, conversation.messages);
                    }
                }
            } catch (err) {
                api.logger.warn(`Session-end indexing failed: ${err.message}`);
            }
        });

        // -------------------------------------------------------------------
        // Service: background maintenance
        // -------------------------------------------------------------------

        const MaintenanceService = require('./services/maintenance');
        let maintenance = null;
        api.registerService({
            id: 'continuity-maintenance',
            start: async (serviceCtx) => {
                await ensureStorage();
                maintenance = new MaintenanceService(config, archiver, indexer);
                await maintenance.execute();
                // Re-index every 5 minutes
                maintenance.startInterval(5 * 60 * 1000);
            },
            stop: async () => {
                if (maintenance) maintenance.stopInterval();
            }
        });

        // -------------------------------------------------------------------
        // Gateway methods — dashboards + debugging
        // -------------------------------------------------------------------

        api.registerGatewayMethod('continuity.getState', async ({ respond }) => {
            respond(true, {
                archive: archiver.getStats(),
                topics: topicTracker.getAllTopics(),
                anchors: anchors.getAnchors(),
                exchangeCount,
                sessionAge: Date.now() - sessionStart,
                indexReady: storageReady
            });
        });

        api.registerGatewayMethod('continuity.getConfig', async ({ respond }) => {
            respond(true, config);
        });

        api.registerGatewayMethod('continuity.search', async ({ params, respond }) => {
            try {
                await ensureStorage();
                if (!searcher) {
                    respond(false, null, { message: 'Searcher not initialized' });
                    return;
                }
                const results = await searcher.search(
                    params?.text || params?.query || '',
                    params?.limit || 5
                );
                respond(true, results);
            } catch (err) {
                respond(false, null, { message: err.message });
            }
        });

        api.registerGatewayMethod('continuity.getArchiveStats', async ({ respond }) => {
            respond(true, archiver.getStats());
        });

        api.registerGatewayMethod('continuity.getTopics', async ({ respond }) => {
            respond(true, {
                topics: topicTracker.getAllTopics(),
                fixated: topicTracker.getFixatedTopics()
            });
        });

        api.logger.info('Continuity plugin registered — context budgeting, topic tracking, archive + semantic search active');
    }
};

// NOTE: Memory Integration instructions moved to AGENTS.md (the proper place
// for agent operating instructions). See "Recalled Memories" section in
// workspace AGENTS.md. This avoids hijacking MEMORY.md, which is the agent's
// own curated memory space per OpenClaw's design.

// NOTE: _writeContinuitySection removed. Session state (topics, anchors,
// exchange count) is delivered via prependContext each turn — no need to
// write it to MEMORY.md. MEMORY.md is the agent's curated memory space
// per OpenClaw's AGENTS.md design.

// ---------------------------------------------------------------------------
// Noise filter for archive exchanges
// Strips meta-failures, session boilerplate, and meta-questions about
// remembering that pollute the archive from repeated testing.
// ---------------------------------------------------------------------------

function _filterUsefulExchanges(exchanges) {
    return exchanges.filter(ex => {
        const agentLower = (ex.agentText || '').toLowerCase();
        const userLower = (ex.userText || '').toLowerCase();

        // --- Agent-side noise: denial patterns, session boilerplate ---
        const agentDenials = [
            "i don't have any",
            "i don't have details",
            "i don't have information",
            "i don't seem to have",
            "i don't have any details",
            "i don't have any saved",
            "no memory of",
            "no information about",
            "no recollection",
            "it looks like i don't",
            "it seems i don't",
            "greet the user",
            "i can help you try to reconstruct",
            "if you could share some details",
            "if you can share what you remember",
            "could you remind me about it"
        ];
        if (agentDenials.some(d => agentLower.includes(d))) return false;

        // --- User-side noise: meta-questions about remembering ---
        if (userLower.includes('a new session was started')) return false;
        const userMetaPatterns = [
            'do you remember',
            'do you recall',
            'do you have any recollection',
            'what do you remember about',
            'can you tell me anything about the',
            "i can't remember",
            "i can't recall",
            "was there anything about",
            "what were all of the details",
            "can you tell me the details",
            "tell me the details",
            "what did i tell you about",
            "did i mention",
            "did i tell you",
            "sorry to keep asking",
            "i was wondering if you remember",
            "hey piper",    // greeting-only turns (no substance)
        ];
        if (userMetaPatterns.some(p => userLower.includes(p))) return false;

        // --- Both-side noise: exchanges with no real content ---
        // If the user message is very short AND agent just acknowledges, skip
        if (userLower.length < 30 && agentLower.includes('if you') && agentLower.includes('let me know')) return false;

        return true;
    });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Distill a user's recall question into a subject-focused search query.
 *
 * Users ask things like "do you recall my sourdough recipe?" — the semantic
 * search then matches OTHER meta-questions ("do you remember my recipe?")
 * instead of the actual recipe exchange. By stripping the recall framing,
 * we get "sourdough recipe" which matches the real content.
 *
 * Pattern borrowed from Clint's retrievalOrchestrator.js query distillation.
 */
function _distillSearchQuery(text) {
    let q = text;

    // Strip common recall/meta preambles — apply iteratively since
    // messages may chain them: "sorry to keep asking but do you recall..."
    const preambles = [
        /^sorry to keep asking[^.?!]*(?:but\s+)?/i,
        /^hey\s+\w+[.,!]?\s*/i,                 // "Hey Piper, ..."
        /^hi\s+\w+[.,!]?\s*/i,                  // "Hi Piper. ..."
        /^do you (?:remember|recall|know)\s*/i,
        /^can you (?:recall|remember|tell me(?: about)?)\s*/i,
        /^what do you (?:remember|recall|know) about\s*/i,
        /^i (?:can't|cannot) (?:remember|recall)\s*/i,
        /^i was wondering if you (?:remember|recall)\s*/i,
        /^(?:do you have )?any (?:recollection|memory) of\s*/i,
        /^(?:the same question\s*)?(?:over and over\s*)?(?:but\s+)?/i,
    ];
    // Two passes to handle chained preambles
    for (let pass = 0; pass < 2; pass++) {
        for (const p of preambles) {
            q = q.replace(p, '');
        }
        q = q.trim();
    }

    // Strip trailing meta-phrases
    const suffixes = [
        /\s*(?:i told you about|i mentioned to you|i shared with you|i provided you)\s*\??$/i,
        /\s*(?:that i (?:told|mentioned|shared|gave) (?:you|to you)[^.?!]*)\s*\??$/i,
        /\s*(?:and the (?:few )?details i provided(?: you)?)\s*\??$/i,
    ];
    for (const s of suffixes) {
        q = q.replace(s, '');
    }

    // Strip leading connectors and meta-words
    q = q.replace(/^\s*(?:but|and|so|the|any of the|all of the|some of the|the details of|details of|any details (?:of|about)|any of)\s*/i, '');
    q = q.trim().replace(/[?.!]+$/, '').trim();

    // If distillation stripped too much, fall back to original
    if (q.length < 5) return text;
    return q;
}

function _stripContextBlocks(text) {
    if (!text) return '';
    // prependContext is baked into the user message by OpenClaw:
    //   [CONTINUITY CONTEXT]\n...\n\n[STABILITY CONTEXT]\n...\n\n[Timestamp] actual user text
    // Strip everything from known context block headers through to the user's actual text.
    // The timestamp marker (e.g. [Mon 2026-02-16 08:57 PST]) signals the start of real content.

    // Strip standalone recall blocks (injected by prependContext but may appear
    // without the [CONTINUITY CONTEXT] header in heartbeat/compacted turns)
    if (text.startsWith('You remember these earlier conversations') ||
        text.startsWith('From your knowledge base:')) {
        const tsMatch = text.match(/\n\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s[^\]]*\]\s*/);
        if (tsMatch) {
            return text.substring(tsMatch.index + tsMatch[0].length);
        }
        // No timestamp found = this is ONLY recall text, no real user message
        return '';
    }

    // Match the full timestamp bracket: [Mon 2026-02-16 09:20 PST]
    const timestampMatch = text.match(/\n\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s[^\]]*\]\s*/);
    if (timestampMatch) {
        return text.substring(timestampMatch.index + timestampMatch[0].length);
    }
    // Fallback: strip known block prefixes line by line
    if (text.startsWith('[CONTINUITY CONTEXT]') || text.startsWith('[STABILITY CONTEXT]')) {
        // Find first line that doesn't look like injected context
        const lines = text.split('\n');
        const realStart = lines.findIndex(line =>
            line.length > 0 &&
            !line.startsWith('[CONTINUITY CONTEXT]') &&
            !line.startsWith('[STABILITY CONTEXT]') &&
            !line.startsWith('[TOPIC NOTE]') &&
            !line.startsWith('Session:') &&
            !line.startsWith('Topics:') &&
            !line.startsWith('Anchors:') &&
            !line.startsWith('Entropy:') &&
            !line.startsWith('Principles:') &&
            !line.startsWith('Recent decisions:') &&
            !line.startsWith('You remember these') &&
            !line.startsWith('- They told you:') &&
            !line.startsWith('  You said:') &&
            !line.startsWith('Speak from this memory') &&
            !line.startsWith('From your knowledge base:')
        );
        if (realStart >= 0) {
            return lines.slice(realStart).join('\n').trim();
        }
    }
    return text;
}

function _extractText(msg) {
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content.map(c => c.text || c.content || '').join(' ');
    }
    return String(msg.content || '');
}

function _extractToolText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.output === 'string') return result.output;
    if (typeof result.text === 'string') return result.text;
    if (Array.isArray(result.content)) {
        return result.content.map(c => c.text || c.content || '').join(' ');
    }
    return '';
}

function _formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just started';
    if (minutes < 60) return `${minutes}min ago`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem > 0 ? `${hours}h ${rem}min ago` : `${hours}h ago`;
}

function _formatAge(timestamp) {
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}min ago`;
    return `${Math.round(minutes / 60)}h ago`;
}

function _truncate(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    // Sentence-boundary-aware truncation: find the last sentence end before maxLen
    const chunk = text.substring(0, maxLen);
    const lastSentence = chunk.search(/[.!?]\s+[A-Z][^.!?]*$/);
    if (lastSentence > maxLen * 0.4) {
        // Found a sentence boundary in the back half — cut there
        return chunk.substring(0, lastSentence + 1) + ' …';
    }
    // Fallback: cut at last space to avoid mid-word breaks
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.6) {
        return chunk.substring(0, lastSpace) + ' …';
    }
    return chunk.substring(0, maxLen - 3) + '...';
}

/**
 * Extract text from a tool result message (for tool_result_persist enrichment).
 * Handles both string content and array-of-parts content formats.
 */
function _extractToolResultText(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (part.type === 'text' && part.text) return part.text;
            if (part.text) return part.text;
        }
    }
    return '';
}
