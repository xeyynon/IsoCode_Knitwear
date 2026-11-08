# Backend cost and performance: research notes

Date: 2026-11-08. Branch: backend-opt. Status: research only, no code was changed.

**Summary.** At pilot size the database is tiny and the CPU is mostly idle, so the bill will be set by three things: the instance size you are forced into, photo storage and bytes sent out, and log volume. The instance size is driven by one pattern in this code: every update a supervisor sends (and every board load) reloads every order, every milestone and every update row ever written, then recomputes every order in the Node process (`refreshWarnings` and `getBoard` both call `loadEngineData` with no filter). That cost grows with the total history, not with the size of the change, so it is the main thing to fix before choosing a server. Second: a few code paths hold a pooled database connection while waiting on object storage or on the next round trip, which forces a larger pool and a larger box than the load justifies. The rest is mostly configuration (logging, compression, ETag, memory limits, lifecycle rules) that is cheap to do and needs no redesign. Each section below ends with what applies to this repo; a final table ranks the work. Figures such as "5 ms" or "300 KB" in this file are placeholders to be replaced by measurements; any claim without a source URL, or marked "unverified", was not confirmed from a source during this research.

**What the code does today (read first, it grounds everything below).**
- `packages/server/src/engineData.ts` `loadEngineData`: 5 queries in parallel (orders+buyer, milestone, update_event, calendar_day, settings). With no `orderId` it reads all rows, no date window, `order by` on each.
- `warningService.ts` `refreshWarnings`: calls `loadEngineData(tx)` for all orders, runs `projectOrder` per order, and updates the `maths` jsonb of every open, unchanged warning on every run.
- `app.ts`: `refreshAfter` runs after `POST /api/events`, ex-factory change and others; `POST /api/events/batch` runs one refresh at the end but opens one transaction per item (up to `MAX_BATCH` = 200).
- `app.ts` auth hook: every request opens its own transaction (`pool.connect`, begin, set_config, select, commit) on the `account` table before the handler opens a second one.
- `pgDb.ts`: `tx` = connect + begin + set_config + work + commit; pool `max: 10`, no `connectionTimeoutMillis`.
- `photoService.ts`: `savePhoto`, `getPhotoBytes`, `getBuyerPhotoBytes`, `purgeRejectedPhotos` call the object store while the transaction (and connection) is open. `s3Store.get` buffers the whole object (`transformToByteArray`). Photo and most GET responses use `Cache-Control: no-store`.
- `server.ts`: `logger: true` (pino at info, so two lines per request), no `SIGTERM` handler, no compression, no ETag, no explicit timeouts.
- Indexes: only `update_event(order_id, stage, date)`, `warning` partial unique `(order_id, stage) where resolved_at is null`, `outbox(created_at desc, id)`, two on `account_audit`, plus primary and unique keys. No index on `update_event.unit_id`, `orders.buyer_id`, `milestone.unit_id`, `photo.order_id`.

---

## 1. PostgreSQL

### What the sources say
- A partial index covers only rows matching a predicate, which cuts index size and write cost; a query can use it only if its WHERE clause provably implies the predicate, and parameterised clauses do not qualify. https://www.postgresql.org/docs/16/indexes-partial.html
- Index-only scans need all queried columns in the index and a set visibility-map bit per heap page; `INCLUDE` adds payload columns without making them search keys, at the price of a bigger index. https://www.postgresql.org/docs/16/indexes-index-only-scans.html
- BRIN stores one min/max summary per block range, is often orders of magnitude smaller than a B-tree, and only prunes well when values correlate with physical row order (timestamps in append-only logs); default 128 pages per range. https://www.postgresql.org/docs/16/brin.html (the fetched page was only the table of contents, so these figures are from general knowledge: unverified)
- `EXPLAIN (ANALYZE, BUFFERS)` shows real versus estimated rows and buffer hits per node; ANALYZE executes the statement, so wrap writes in a transaction you roll back; stale statistics are fixed by `ANALYZE`. https://www.postgresql.org/docs/16/using-explain.html
- `pg_stat_statements` gives calls, total and mean execution time and rows per normalised query; it needs `shared_preload_libraries` and a restart. https://www.postgresql.org/docs/16/pgstatstatements.html
- `shared_buffers`: start near 25% of RAM on a dedicated server, more than 40% is unlikely to help, and below 1 GB RAM use a smaller share. `work_mem` (default 4 MB) is per sort or hash node, so the total can be many times the setting across nodes and sessions; hash nodes may use `work_mem * hash_mem_multiplier` (default 2.0). https://www.postgresql.org/docs/16/runtime-config-resource.html
- `max_connections` default is 100, set at start; every connection is a backend process. https://www.postgresql.org/docs/16/runtime-config-connection.html
- Per-connection memory is lower than the old "10 MB" rule of thumb: measured under 2 MiB with huge pages, and `top` or `ps` overstate it. https://www.citusdata.com/blog/2020/10/08/analyzing-connection-scalability/ (secondary summary of the author's posts; the exact figure varies with workload)
- node-postgres `Pool`: `max` 10, `idleTimeoutMillis` 10000, `connectionTimeoutMillis` 0 (wait forever), `maxLifetimeSeconds` off by default; do not use `pool.query` for a transaction. https://node-postgres.com/apis/pool
- Row-level security: policy expressions run per row before the user's conditions; policies that look only at the current row are the simplest and fastest; sub-selects add work per evaluation; FORCE makes table owners subject to policies. https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- Wrapping a per-request function in `(select fn())` lets the planner run it as an initPlan and cache the result for the statement instead of calling it per row; index every column a policy filters on. https://supabase.com/docs/guides/database/postgres/row-level-security (vendor docs; no benchmark numbers given)
- Autovacuum triggers on inserts since PG13 (`autovacuum_vacuum_insert_*`), which sets visibility-map bits and freezes tuples; dead tuples come from UPDATE and DELETE, so append-only tables need little reclamation. https://www.postgresql.org/docs/16/routine-vacuuming.html (the PG13 version is from general knowledge: unverified)
- Partitioning pays off mainly when a table would exceed physical memory; many partitions raise planning time and per-session memory; a unique constraint on a partitioned table must include the partition key. https://www.postgresql.org/docs/16/ddl-partitioning.html
- `jsonb` is preferred over `json`; any update locks and rewrites the whole row, so keep documents small and atomic. https://www.postgresql.org/docs/16/datatype-json.html
- `CREATE INDEX CONCURRENTLY` avoids blocking writes but scans twice, cannot run inside a transaction block and can leave an invalid index on failure. https://www.postgresql.org/docs/16/sql-createindex.html
- PgBouncer 1.21+ supports protocol-level prepared statements in transaction pooling when `max_prepared_statements` > 0; SQL-level PREPARE still breaks. https://docs.pgedge.com/pgbouncer/v1-24/usage/ (secondary; default value differs between sources, check your version)
- Planner join methods are nested loop, merge and hash, chosen by estimated cost. https://www.postgresql.org/docs/16/planner-optimizer.html

### Applies here?
- **Indexes (later, after EXPLAIN).** At pilot size a sequential scan of a few thousand rows is faster than an index, so adding indexes now buys nothing. When `update_event` reaches the "bigger than a few hundred MB" range, add (with `CONCURRENTLY`): `update_event(unit_id)` (supervisor RLS and `getMyStages`), `orders(buyer_id)` and `milestone(buyer_id)`, `milestone(unit_id)` (the `sup_orders` policy runs an EXISTS on milestone per order row), and a partial `photo(created_at) where approved_by is null and rejected_at is null` for the pending-photo queue. Lever: CPU and disk read I/O, so a smaller instance holds up longer. Effort S each. Cost of each index: write amplification and disk, so add only those EXPLAIN justifies.
- **Covering/INCLUDE: no for now.** The one hot read is "all events for an order ordered by date" and the table is read in full anyway. Revisit only if the fix in section 7 moves to per-order reads.
- **BRIN: not worth it yet.** The "newest N" lookups (`outbox`, `account_audit`) are LIMIT-N-by-time, where a B-tree is ideal and BRIN is poor at top-N. `update_event.received_at` is physically ordered, so BRIN would suit a future "events since X" delta query, but the reads here filter by `order_id`/`date`, and `date` is supervisor-entered so back-dated entries weaken the correlation.
- **EXPLAIN-first workflow: do now.** Turn on `pg_stat_statements`, run the five `loadEngineData` queries under `EXPLAIN (ANALYZE, BUFFERS)` against a seeded dataset of realistic size, and record row counts. Effort S; lever: avoids buying capacity to hide a fixable scan.
- **Connections: do now.** The pool (`max: 10`) is already modest. Set Postgres `max_connections` near pool size + headroom for migrations, backups and a console (for example 20 to 30, a placeholder), not 100; the saving in RAM is small, the value is a hard ceiling that stops a runaway client from taking the box down. Add `connectionTimeoutMillis` (a few seconds) so overload returns an error instead of queueing forever; today it waits without limit. Effort S.
- **Memory on a small VM.** Suggested starting point to be validated by measuring: `shared_buffers` about 25% of RAM, leave the rest to the OS page cache and Node, keep `work_mem` at the 4 MB default (the queries here are small sorts), `effective_cache_size` as a planner hint of roughly RAM minus Node and OS (it reserves nothing). Do not raise `work_mem` to "fix" the large `order by` queries; fix the volume instead. A 2 GB example with 512 MB shared buffers appears in a mailing-list thread: https://postgrespro.com/list/thread-id/1503044 (old, informal: unverified).
- **RLS pitfalls: verify, do not rewrite blindly.** Policies call `app_role()`, `app_is_staff()` etc., which are `language sql stable` wrappers over `current_setting`. A trivial SQL function is normally inlined, but the planner will still evaluate the stable expression per row in a seq-scan filter (unverified here: confirm in EXPLAIN output). The `(select ...)` initPlan trick is documented for another platform's functions; for this schema it would mean writing `using ((select app_is_staff()))`. Changing policies is security-sensitive and the existing `rls.test.sql` must pass unchanged. Do it only if EXPLAIN shows the function call among the top costs of the full-table reads. Lever: CPU. Effort S to M.
- **Partitioning: not worth it.** The unique key `update_event.client_uuid` is the idempotency guarantee, and a partitioned table would need the partition key inside that constraint, which would break "a repeat of this id is never counted twice". Data is far below RAM size. Dropping old data is better done by archiving closed orders (section 7).
- **JSONB.** `orders.sizes` is small. `warning.maths` is rewritten on every refresh even when nothing changed (see `refreshWarnings`, last `else if (!have.dismissed)` branch). Postgres writes a new row version for every UPDATE (dead tuples come from UPDATE per the vacuum page), so each event post rewrites every open warning: extra WAL, extra dead rows, bigger backups. Fix: add `and maths is distinct from $2::jsonb` to the update, or compare in Node. Effort S; lever: WAL/disk I/O, backup size, autovacuum work. **Do now.**
- **Autovacuum.** Defaults are fine for the append-only `update_event`, `date_change`, `account_audit`. The update-heavy table is `warning` (and `account` counters); after the fix above, defaults suffice. No tuning now.
- **Prepared statements: later, small.** Queries are unnamed, so each is parsed and planned each time. Named statements (`name` in the query config) save planning time on hot queries but the saving is typically sub-millisecond on simple queries (unverified) and they matter only if a transaction-mode pooler is added; if so, require version 1.21+.

---

## 2. Node.js and Fastify 5

### What the sources say
- Fastify defaults: `bodyLimit` 1 MiB, `keepAliveTimeout` 72 s, `connectionTimeout` 0, `requestTimeout` 0 (no limit; the docs say it must be non-zero when there is no reverse proxy), `forceCloseConnections` "idle" when supported, `return503OnClosing` true, logger off unless enabled and level `info` when on. https://fastify.dev/docs/latest/Reference/Server/
- A route with a response schema is serialised by fast-json-stringify, which the docs say can drastically raise throughput and stop accidental leaks of unlisted properties; no figures given. https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Pino levels: trace 10, debug 20, info 30, warn 40, error 50; raising `level` reduces load; `redact` removes paths such as `req.headers.authorization`. https://github.com/pinojs/pino/blob/main/docs/api.md and https://fastify.dev/docs/latest/Reference/Logging/
- Event loop: keep callbacks cheap or bound the input; `JSON.parse`/`stringify` are O(n) and can block on large payloads; long work can be split with `setImmediate` or moved to a worker pool, which costs serialisation between threads. https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- Node 22 CLI has `--max-old-space-size-percentage`, which takes precedence over `--max-old-space-size`. https://nodejs.org/docs/latest-v22.x/api/cli.html
- Without the flag, V8 sizes the old heap from available memory (reports say about half of a container's limit, with caps); the exact ceiling for Node 22 was not confirmed. https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers (unverified for 22)
- Node `http` defaults: `keepAliveTimeout` 5000 ms, `requestTimeout` 300000 ms, `headersTimeout` min(requestTimeout, 60000). https://nodejs.org/docs/latest-v22.x/api/http.html
- `cluster` forks workers sharing a port with round-robin; workers are separate processes so in-memory state is not shared. https://nodejs.org/docs/latest-v22.x/api/cluster.html
- `@fastify/compress` supports br, gzip, deflate (zstd on Node 22.15+), compresses buffered payloads of at least 1024 bytes by default, brotli quality 0 to 11 with default 4. https://github.com/fastify/fastify-compress
- Container CPU limits are enforced by cgroup `cpu.max` (quota per period), so a service can be throttled while the host looks idle; startup and GC bursts are exposed. https://docs.kernel.org/admin-guide/cgroup-v2.html and https://jorijn.com/en/knowledge-base/kubernetes/monitoring/kubernetes-cpu-throttling-pods-stall-low-utilisation/ (vendor blog)

### Applies here?
- **Event-loop blocking: the real risk is `projectOrder` for all orders.** It is synchronous CPU in the request path (`getBoard`, `refreshWarnings`). Cost per call is roughly (events + orders x stages) work; as history grows the loop stalls and every other request waits. Measure with `perf_hooks.monitorEventLoopDelay` (from memory: unverified) before and after the fixes in section 7. Lever: CPU, hence instance size.
- **Memory.** Start with `NODE_OPTIONS=--max-old-space-size-percentage=` (or a fixed MiB value) at roughly 60 to 70% of the share of RAM you give Node, so V8 collects before the kernel kills the process (rule of thumb: unverified). Photo buffers live outside the old heap (Buffers), so leave headroom: N concurrent 3 MB uploads/downloads is 3N MB. Effort S; lever: avoids oversizing RAM.
- **Single process, no clustering.** On 1 to 2 vCPU one process is right: in-process state (`statusCache`, the board memo proposed below) stays coherent, and the S3 and pg clients are shared. Cluster only if CPU-bound after the section 7 fixes. Not worth it now.
- **Response schemas.** Add `response` schemas to the busiest GET routes (board, my/stages, review). Gains: faster serialisation and a guarantee that internal fields (for example `lowConfidenceStages`, documented as "never sent to a buyer") cannot leak. Modest CPU saving, real safety value. Effort M; later.
- **Timeouts and shutdown (do now, S).** Set `requestTimeout` (photo uploads over weak mobile links need a generous value, for example a minute; placeholder), `connectionTimeout`, and a `SIGTERM`/`SIGINT` handler that calls `app.close()` then `pool.end()`. Today `server.ts` has none, so a restart during a deploy can kill in-flight transactions; the phone's idempotent retry makes this survivable but wasteful. (`close-with-grace` is a common helper; its README could not be fetched: unverified.)
- **Keep-alive.** Fastify's 72 s `keepAliveTimeout` should exceed the reverse proxy's idle timeout toward the upstream, otherwise the proxy can reuse a socket the server just closed (general behaviour, unverified here). Keep upstream keep-alive on in the proxy (section 8).
- **Compression.** Do it at the reverse proxy (one layer only), level around 4 to 6, skip below about 1 KB, never compress JPEGs (already compressed). Sources are vendor blogs and agree only loosely on savings, so measure the real board payload: https://www.ayrshare.com/http-compression-in-node-js-a-dive-into-gzip-deflate-and-brotli/ (weak source). Lever: egress. Effort S.
- **Body limits.** Default 1 MiB is fine for a 200-event batch (a few tens of KB); photos already have a route limit. Set explicit per-route limits to document intent. S.

---

## 3. HTTP caching and bandwidth

### What the sources say
- `no-store` forbids storing at all and loses back/forward cache; `no-cache` stores but must revalidate; `private` limits to the end user's browser. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- Hashed filenames can be cached for a year with `immutable`; stale entries are revalidated with `If-None-Match` and a 304 carries no body. Same MDN page.
- `If-None-Match` uses weak comparison; `If-Match` on writes gives optimistic locking (412 on mismatch). https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests
- `@fastify/etag` hashes the already-produced payload (sha1 default, weak option) and answers 304 on a match. It does not avoid running the handler: the saving is bytes, not server work. https://github.com/fastify/fastify-etag (the order of handler versus hashing is implied, not stated)

### Applies here?
- **Replace blanket `no-store` with `private, no-cache` + ETag on lists the phone and board re-fetch** (`/api/board`, `/api/review`, `/api/my/stages`, order detail). The data stays fresh (always revalidated) and bytes drop to a header when nothing changed. `no-store` is correct only where the body must never be kept (account lists, PIN-related responses); keep it there. Lever: egress, phone data use. Effort S to M. Caution: the ETag must be computed from the post-RLS response so two roles never share one.
- **Make 304 cheap on the server too**: build the ETag from a cheap version number (see the board memo in section 7), return 304 before loading data. That saves CPU, the thing `@fastify/etag` alone does not. Effort M.
- **Photo bytes**: the file at a given id never changes, but who may see it does (approve, withdraw). Use `private, no-cache` with `ETag` = photo id, so a withdrawn photo is refused on the next check and an unchanged one costs a 304 with no S3 read. Do not use `max-age` on buyer photos (a withdrawn photo would stay in the buyer's cache). Lever: S3 request count, egress. Effort S.
- **Static assets of the web app** (served elsewhere): hashed Vite files `public, max-age=31536000, immutable`; `sw.js` and `index.html` `no-cache` so a new build is found (service-worker caching advice from memory: unverified). The README says a new version waits and installs in the background, which relies on this.
- **Payload slimming**: board rows repeat `buyerName`, `units[].name`, `maths` strings; gzip handles repetition well. A leaner step is a `fields` or "summary" shape for the phone's list screens (unverified saving). Do after compression, only if bytes remain high.
- **Delta sync for the phone**: down-sync is small (my stages, today's totals), so a full fetch plus ETag is enough. A "since" token would only matter if lists grow large. Not worth it now. Up-sync is already a batched, idempotent upload, which is the right shape.

---

## 4. Object storage (S3-compatible)

### What the sources say
- Lifecycle rules do two things: transition to another class, and expire. Transitions have per-request ingestion charges; expiring objects in classes with a minimum storage duration can incur a charge. Rules apply to existing and new objects. https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html
- Multipart upload is recommended from about 100 MB; incomplete multipart uploads keep billing until completed or aborted, so set an `AbortIncompleteMultipartUpload` lifecycle rule. https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- A presigned URL is a bearer credential tied to its creator's permissions; SDK expiry can be up to 7 days, and clock skew causes signature errors. https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- One S3-compatible provider documents billing as storage, two classes of operations, retrieval (infrequent tier only) and no charge for egress bandwidth; the infrequent tier has a minimum storage duration; deletes and aborting multipart uploads are free. https://developers.cloudflare.com/r2/pricing/ (one provider only; others differ: check each price sheet)
- Image sizing: resize to the largest displayed size, compress lossy, serve smaller variants for lists. Quality and savings figures differ between guides (70 to 85 quality, 60 to 75% savings quoted): treat as unverified and test on your own photos. https://web.dev/articles/use-srcset-to-automatically-choose-the-right-image

### Applies here? (formulas, no prices: check the current price sheet)
- **Monthly storage line** = (average GB stored) x (per-GB-month price) + (PUT/COPY/LIST count / 1000 x price per 1000) + (GET count / 1000 x price per 1000) + (GB out x egress price, if any). Photos are the only large data, so the bill follows `photos per day x bytes per photo x days kept`.
- **Retention is the biggest lever and is missing.** `purgeRejectedPhotos` deletes only rejected photos, only when someone calls it. Waiting and approved photos are kept forever, so storage grows without bound. Add: (a) a rule that removes the files of orders shipped more than a chosen time ago (keep the row, set `purged_at`, which the code already treats as "no file"), (b) a bucket lifecycle rule as a backstop on the `photos/` prefix. Effort M; lever: storage.
- **Delete requests while holding a transaction**: `purgeRejectedPhotos` deletes object by object inside one DB transaction. Fine at pilot scale; at hundreds, page it (for example 100 per call) so the transaction stays short.
- **Storage class: not worth tiering.** Photos of about 100 to 300 KB (placeholder) are small objects; infrequent-access tiers carry retrieval fees, minimum duration and (on some providers) minimum billed object size, which erase the saving for small, short-lived files (minimum-size rule from memory: unverified). Expire instead of tier.
- **Multipart: not applicable.** `s3Store.put` uses one `PutObject` for objects capped at 3 MB (hard cap 5 MB); the 100 MB guidance does not apply. Still add the abort-incomplete rule if any tool ever uploads large files; it costs nothing.
- **Request count versus size.** For 200 KB objects the per-request charge, not the per-GB charge, can dominate on some price sheets. Reduce GETs with ETag/304 (section 3) and by serving thumbnails from one fetch. Lever: request count.
- **Image size targets.** The phone already shrinks before upload (README). Pick a target (for example long edge about 1280 px, lossy quality about 75 to 80, aiming for 100 to 250 KB: placeholders, verify with real shots) and enforce a lower hard cap than 3 MB. Add a small thumbnail (about 320 px, tens of KB) made on the phone, used in the review queue and board, with the full photo opened on demand. Doing it on the phone moves CPU off the server. Lever: storage and egress, 5 to 10 times fewer bytes on list screens (estimate, unverified).
- **Egress: streaming through the API versus signed URLs.**
  - Streaming (today): every photo view moves the bytes store to API (often free inbound to the VM) and API to client (counts against the VM's outbound allowance), and holds Node memory and a DB connection while it happens. Authorisation is checked on every view, and the design rule "nobody is given a bucket address" holds.
  - Presigned URL: the API checks access and signs a link valid for a short time (tens of seconds); bytes go store to client directly. Saves VM egress, RAM, CPU. Cost: the link is a bearer token, anyone holding it can use it until it expires, and the README rule would need an explicit decision.
  - Recommendation: keep streaming for the pilot, but fix it (stream, do not buffer; release the DB connection before touching storage; ETag/304). Revisit presigned URLs only if the VM's outbound allowance, not CPU, becomes the limiting quantity, and then with a short expiry.
- **Connection held during storage I/O (do now, M).** `savePhoto` calls `store.put` inside the transaction; `getPhotoBytes`/`getBuyerPhotoBytes` call `store.get` inside it. With pool `max: 10` and a slow store, ten simultaneous photo requests exhaust the pool and the auth hook (which also needs a connection) stalls every other request. Read the row, commit, then fetch/stream. For uploads, either cap concurrent photo requests with a small semaphore (for example 3), or put the object first then insert (accepting a rare orphan, swept by lifecycle). Lever: connections, therefore instance size.
- **Region.** Keep the bucket in the same region as the server (already an India-region requirement in the README): avoids inter-region transfer and shortens round trips (price-sheet check needed for inter-region charges: unverified).
- **Orphans**: a successful `put` followed by a failed commit leaves an object with no row. Rare; a quarterly list-and-compare job or a lifecycle expiry on very old objects not referenced is enough. Later.

---

## 5. Logging and observability cost

### What the sources say
- Fastify logging is off by default; when on, level `info`; raising the level reduces load; `redact` hides secrets; `pino-pretty` is excluded for performance. https://fastify.dev/docs/latest/Reference/Logging/ and https://github.com/pinojs/pino/blob/main/docs/api.md
- Postgres: `log_min_duration_statement` (off by default) logs only slow statements; `log_statement = all` can expose sensitive data; `log_checkpoints` is on by default; rotation by age (24 h) and size (10 MB) needs `logging_collector`. https://www.postgresql.org/docs/16/runtime-config-logging.html
- Pino has no built-in sampling (from memory: unverified); sampling is done by level, by route, or in a transport.

### Applies here?
- **`logger: true` is a log-volume cost (do now, S).** Each request writes a request line and a response line at info. Volume per day = requests per day x lines per request x bytes per line (placeholder: 2 x 300 bytes). Even a modest 50,000 requests a day is about 30 MB a day, about 11 GB a year, which is a disk and (if shipped) an ingestion cost. Set level to `warn` in production, or keep info but turn off the per-request pair and log one summary line only for slow (over some threshold) or failed requests. Never log per batch item. Add `redact` for `req.headers.authorization` as a guard.
- **Retention.** Log to stdout, let the platform (journald or the container runtime) rotate with a size cap, and keep a bounded window on the VM. Ship only warn/error off-box, if at all. The container runtime's default JSON log driver has no rotation unless configured (unverified: check your runtime).
- **Postgres.** Set `log_min_duration_statement` to a slow threshold (for example 200 ms, a placeholder) instead of any `log_statement`, keep `log_checkpoints` on, enable `log_lock_waits` (the advisory lock in `submitEvent` makes lock waits worth seeing). Enable `pg_stat_statements` and look at it weekly rather than logging queries.
- **Metrics instead of logs.** A tiny `/api/status` already caches its check (good pattern). Cheap signals worth having: event-loop delay, pool waiting count (`pool.waitingCount`), request duration histogram in memory, DB size, and disk free. Expose through the existing status path or a log line every few minutes. Lever: avoids paying for an external monitoring tier.
- **Alerts volume.** The outbox is written inside business transactions and never pruned. When alerts go real, add retention and a relay; until then, prune rows older than a chosen window. S.

---

## 6. Compute right-sizing and hosting patterns

### What the sources say
- A serverless function's cold start (download, environment, init code) typically occurs in under 1% of invocations in production, ranges from under 100 ms to over 1 s, and database connections are held per execution environment, so concurrency multiplies connections. https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- A serverless Postgres vendor suspends compute after a 5 minute idle timeout and reports reactivation within a few hundred milliseconds. https://neon.com/docs/introduction/scale-to-zero
- Managed Postgres `max_connections` is tied to instance size or memory; examples range from about 100 for small tiers; a pooler is the usual remedy. https://neon.com/blog/postgres-support-case-recap and https://docs.severalnines.com/ccx/user/Reference/Products/PostgreSQL/configuration/ (vendor material; check each provider's current docs)
- Backups: base backup plus WAL archive gives point-in-time recovery but needs archive storage that grows with write volume and restores slower as WAL accumulates; `pg_dump` is logical, typically smaller, restores per database, and has no point-in-time recovery. https://www.postgresql.org/docs/16/continuous-archiving.html

### Applies here?
- **Single small VM with Postgres on the same host is the cheapest fit.** Workload: tiny CRUD plus a CPU-light rules function, steady use during factory hours, low traffic at night, long-lived phone sessions. Same-host Postgres removes network round trips (the code makes about 4 to 6 per transaction and 2 transactions per request, see section 7), removes a separate database line item, and can use a Unix socket. Cost: you own upgrades, tuning and backups.
- **Managed Postgres**: pay to avoid operating backups and failover; connection caps are tied to size, which interacts badly with idle pool connections (here `max: 10` is fine). Round trips cross the network, so the per-request chatter in the code starts to matter (each millisecond of round trip x 8 or 10 per request).
- **Serverless app tier: poor fit.** Photo upload and download stream through the API, the process keeps in-memory caches (`statusCache`, proposed board memo), and per-invocation connections multiply. The Node-in-Lambda payload ceilings were not confirmed (unverified). It would save idle time, but the workload is idle only at night and the owner would pay in cold starts on the first phone sync of each shift.
- **Scale-to-zero database**: wake-up of a few hundred ms is fine for dashboards, but the phone sync arrives at fixed times and the first request would pay it; also the app's auth hook queries the database on every request. Possible, not compelling. Lever to weigh: idle hours versus complexity.
- **Backups (cost lever, do early).** Nightly `pg_dump` compressed to a different bucket or region: size is the logical data, small (the invented example in section 9 gives about 1.5 GB a year before compression; the dump compresses well), plus a restore drill. Add WAL archiving only if the owner needs a recovery point of minutes; it adds storage that grows with write volume, so first fix the per-event warning rewrites (section 1), which inflate WAL. Keep a retention window (for example 14 daily copies, placeholder) with a lifecycle rule.
- **Sizing method.** Measure idle RSS of Node and Postgres on a seeded dataset, add the peak photo concurrency (N x 3 MB), then pick the smallest tier with 30 to 40% headroom and revisit after the section 7 fixes. Do not buy size to hide the full-recompute pattern.

---

## 7. Algorithms and data structures (DSA / DAA) in this workload

### What the sources say
- B-tree lookups are logarithmic: nodes hold many entries so depth stays small (four or five levels for millions of rows) and the tree remains balanced as rows change, at the price of write overhead. https://use-the-index-luke.com/sql/anatomy/the-tree
- Join strategies: nested loop is good when the inner side is indexed; merge join sorts both sides once or uses an index order; hash join builds a table on one side and probes with the other. https://www.postgresql.org/docs/16/planner-optimizer.html
- Amortised analysis averages cost over a sequence; occasional expensive steps (a resize) can still give O(1) average per operation. https://en.wikipedia.org/wiki/Amortized_analysis
- PostgreSQL 16 materialised views refresh by re-running the whole query; there is no incremental refresh (CONCURRENTLY needs a unique index). https://www.postgresql.org/docs/16/sql-creatematerializedview.html (the fetched page said nothing about refresh; the statement comes from general knowledge: unverified)
- `FOR UPDATE SKIP LOCKED` exists for queue-like tables with several consumers. https://www.postgresql.org/docs/16/sql-select.html

### Applies here? Concrete spots in this repo
Let O = orders, S = stages per order, E = all update events ever, D = calendar rows, K = events for one order.
- **Does a mutation recompute every order? Yes.** `POST /api/events`, `/api/events/batch` (once at the end), ex-factory change and others call `refreshWarnings`, which calls `loadEngineData(tx)` without an order id and runs `projectOrder` for all O orders. Cost per write is Theta(E + D + O x S + sum of per-order work), where only one order changed. Over a season of W writes the total is Theta(W x E), quadratic in activity. This is the main finding.
- **Does the board read every event row? Yes.** `getBoard` loads all of `update_event` (no date window, no archive of shipped orders), sorts it in SQL by (order_id, date, client_uuid), groups it in JS, and recomputes. Reading is linear in history, so cost climbs forever even though the engine uses only the last few working days for the pace figure (its total-produced count needs a per-stage sum, not every row).
- **Fix 1: scope the refresh (do now, M).** `loadEngineData(tx, orderId)` already supports one order. Pass the affected order ids (the batch knows them) to `refreshWarnings`; resolve only warnings of those orders. Keep one full pass per day (when "today" in India rolls over, colours can change with no event) and on settings/calendar changes. Cost per write becomes Theta(K + S) instead of Theta(E + O x S).
- **Fix 2: coalesce bursts (do now, S).** Batches from several phones arrive together after a signal returns. Run at most one refresh at a time and, if more arrive meanwhile, one more after it (single-flight with a trailing run). That is amortised O(1) refreshes per burst instead of one per request, the same idea as the dynamic-array argument above. The refresh already runs as a separate transaction after the commit and is allowed to fail, so deferring it is safe.
- **Fix 3: memoise the board (when load grows, M).** Key: (`today`, a data version number). Keep the version as an in-process counter bumped by every mutating route; with one process this is exact and cheap. Per-order variant: cache `projectOrder` output keyed by (order id, `today`, count and max `received_at` of its events, settings version). Invalidation is the hard part, so keep the rule simple and have a "no cache" env switch for debugging. Breaks if you later add worker processes (state not shared), and then use a database version row instead.
- **Fix 4: shrink the input (when load grows, M).** Exclude closed orders (all stages complete or ex-factory long past) from the default board and refresh, with an "archived" view; pre-aggregate events per (order, stage, day) in SQL. The engine de-duplicates by `clientUuid` and the confidence logic needs which events were entered on behalf, so aggregation must be done behind a test that proves identical output. Product decision needed for archiving.
- **Indexes as B-trees.** An order lookup by id or the unique `(order_id, stage)` is O(log n); a full scan is O(n). `order by order_id, date, client_uuid` on `update_event` does not match the index `(order_id, stage, date)`, so the database sorts the whole result (O(n log n)); it is Postgres work per call, another reason to read one order at a time.
- **Joins.** `orders join buyer` with a handful of buyers is a hash or nested-loop join of trivial cost. The `sup_orders` policy's correlated EXISTS on milestone is a nested loop with an index probe per order (the unique key on `(order_id, stage)` serves it). No change needed.
- **Sorting.** `getBoard` sorts the final array (O(O log O)) and the engine sorts date keys per stage: negligible next to the data load. Do not optimise these.
- **Batching.** `/api/events/batch` opens one transaction per item. Each commit forces a WAL flush, so 200 items mean 200 flushes, about 5 round trips each, and 200 connection checkouts. One transaction per batch with a `savepoint` per item keeps "one bad item does not sink the rest" and cuts commits to one. Details to keep: sort items by `clientUuid` before taking the advisory lock so two overlapping batches cannot deadlock; keep the infrastructure-error rule (rethrow so the phone retries all). Lever: WAL fsync I/O, connection time. Effort M. Do now.
- **Per-request auth transaction.** Each request pays 4 round trips for a token-version check before the handler's own transaction. Options: cache `(account id -> token_version, disabled, unit)` for a few seconds in-process and clear the entry on every local sign-out/stop/PIN-reset (single process makes that exact); or merge into the handler's transaction. The trade-off is how fast a stopped account loses access, which the README treats as immediate, so use a very short lifetime plus explicit invalidation. Effort M; lever: DB round trips, CPU.
- **Space-time trade-offs.** In-memory memo (RAM) versus recompute (CPU); thumbnails (storage) versus resizing on the fly (CPU); an extra index (disk and write cost) versus scans (read cost). At this size prefer the choice that uses the cheaper resource on the chosen instance; RAM is usually the scarcer one on a small box, so prefer small memos keyed by version over large caches.

---

## 8. Operating-system concepts

### What the sources say
- The Linux OOM killer can kill the Postgres postmaster; mitigations are strict overcommit (`vm.overcommit_memory=2`), setting the postmaster `oom_score_adj` to -1000, and lowering `shared_buffers`, `work_mem`, `max_connections`. File-descriptor limits (`fs.file-max`, `max_files_per_process`) matter because each connection is a process. Huge pages help only if reserved. https://www.postgresql.org/docs/16/kernel-resources.html
- cgroup v2: `memory.max` is the hard limit (OOM kill inside the group), `memory.high` throttles instead of killing, `memory.swap.max` caps swap, `memory.current` counts page cache plus kernel structures including socket buffers, `cpu.max` is a quota per period. https://docs.kernel.org/admin-guide/cgroup-v2.html
- Without upstream keep-alive, a proxy opens a new connection per request and closed sockets linger in TIME_WAIT for about a minute on Linux, which can exhaust ephemeral ports at high request counts; enabling keep-alive is the fix, widening the port range only buys headroom. https://www.netdata.cloud/guides/nginx/nginx-upstream-keepalive/ (vendor guide)
- `fsync = off` and `full_page_writes = off` can cause unrecoverable corruption after a crash; `synchronous_commit = off` can lose up to about three times `wal_writer_delay` (about 600 ms by default) of committed transactions but does not corrupt; `wal_compression` trades CPU for less WAL; `max_wal_size` (default 1 GB) and `checkpoint_timeout` (5 min) trade crash-recovery time for fewer checkpoints. https://www.postgresql.org/docs/16/runtime-config-wal.html
- Clock accuracy: signed requests fail with `SignatureDoesNotMatch` when the clock drifts (use NTP); `chronyd` keeps a system clock synchronised and can step it. https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html and https://chrony-project.org/doc/4.6/chrony.conf.html

### Applies here?
- **File descriptors / ulimit.** Needs: Node sockets (clients, proxy, pool of 10, S3 sockets) plus Postgres backends. Defaults are generous for this size; set an explicit `LimitNOFILE` (for example a few thousand, placeholder) in the service unit so a leak shows as an error, not a mystery. S.
- **TIME_WAIT.** Node to Postgres uses a pool (long-lived sockets): fine. Proxy to Node: enable upstream keep-alive. Node to S3: the SDK normally reuses connections (unverified: check agent settings). With a Unix socket to a local Postgres the issue disappears for that hop. Verify with `ss -tan state time-wait | wc -l` under a load test.
- **Page cache.** Postgres relies on the OS page cache for most reads; do not give all RAM to `shared_buffers` or the Node heap. In a container, page cache counts toward the group's memory, so a tight `memory.max` shrinks the cache first (fine) and a hard OOM follows only when anonymous memory (heap, Buffers, work_mem) cannot fit.
- **Swap and OOM.** Prefer: no swap thrash, but a small swap area as a pressure valve is reasonable (mailing-list view that any swap use means undersized: unverified). Run Postgres and Node in separate memory groups or units; protect the postmaster with `oom_score_adj`; use `memory.high` if available to throttle before killing. Lever: avoids both an outage and an oversized instance.
- **CPU throttling.** If the host plan gives a fractional or quota-limited CPU, Node start-up, GC and full-board recomputes will hit the quota and show as latency spikes without high average CPU. Check `cpu.stat` throttled counters; the section 7 fixes reduce burst length. If the plan uses burstable CPU credits, sustained recompute loops can exhaust credits (plan-specific: check the provider's docs).
- **Disk I/O and WAL.** Per-event commits mean frequent small fsyncs; batching (section 7) is the safe fix. Keep `wal_compression` off until WAL volume is measured, then consider it for smaller backups. Keep default `max_wal_size` unless the disk is tiny.
- **What is unsafe for data.** Never `fsync = off` or `full_page_writes = off` on this system (corruption on power loss). `synchronous_commit = off` is not corruption-safe-by-accident here either: the API answers "accepted" and the phone then drops the update from its offline queue, so a crash in the roughly 600 ms window loses an update that the phone believes is stored. Do not turn it off for event writes. It could be set per transaction (`set local`) for derived work such as the warning refresh, but that transaction also writes outbox alerts, so skip it unless alerts are moved out. Lever would be fsync I/O; the batching fix gets most of the same gain safely.
- **Time sync (do now, S).** Run chrony or timesyncd. The server computes "today" in India from its clock (`istDate(clock())`) and rejects future-dated updates and colours against it; token expiry and S3 request signing also depend on it. Add a clock-drift check to the status route.

---

## 9. System design

### What the sources say
- Idempotency keys: the client generates a unique id per operation and reuses it on retry; the server correlates it with request state; clients retry with exponential backoff plus jitter. https://stripe.com/blog/idempotency
- Transactional outbox: write the outgoing message in the same transaction as the business change, publish with a relay; the relay can publish twice, so consumers must be idempotent. https://microservices.io/patterns/data/transactional-outbox.html
- `SKIP LOCKED` lets several consumers take rows from a queue-like table without waiting on each other. https://www.postgresql.org/docs/16/sql-select.html
- Postgres connection capacity is limited by the server's `max_connections` and per-connection overhead; use a pooler when many app instances exist. Sources in section 1 and 6.

### Applies here?
- **Idempotency: already in place and sound.** `client_uuid` unique + `on conflict do nothing` + a transaction-scoped advisory lock gives exactly-once effect under retries and overlaps. Keep. Add: client backoff with jitter on the phone (the offline queue; web package not reviewed here: unverified), and return a stable result for a duplicate (already done).
- **Outbox: already the right shape** (rows written in the same transaction, delivery mocked). When real sending is added: a polling relay with `FOR UPDATE SKIP LOCKED`, a `sent_at` column, retry counter, and retention. No broker. Until then prune old rows.
- **Backpressure and limits.** Current protection: `MAX_BATCH` 200, sign-in rate limits, photo size limits. Missing: a bounded wait for a database connection (`connectionTimeoutMillis`; today it queues forever), a cap on concurrent photo transfers, and a clear 503 + `Retry-After` when overloaded, which the phone's backoff then honours. A per-user request limiter is optional at this scale (an in-memory limiter per process is enough; library behaviour unverified).
- **Caching and invalidation.** Safe, high-value caches: `/api/status` (exists), reasons and settings (rarely change; invalidate on write), the board memo (section 7), account lookup for the auth hook (short life + explicit clear). Rule: every cache must have one named invalidation point and a way to switch it off.
- **Read replicas: not worth it.** One small database, reads and writes on the same few tables, and the problem is the amount of work per request, not read throughput. A replica doubles the database line item and adds lag that would show stale colours.
- **Queues: defer.** Postgres outbox + `SKIP LOCKED` covers alerts; the warning refresh is a function call, not a job. Add a broker only if there are multiple services.
- **Rolling restarts.** Migrations are run by hand as the owner; keep them backward compatible with the previous app version so a deploy never needs both to switch at once (practice: unverified here).

### Capacity estimate method (formula; the numbers are invented placeholders, replace with measured values)
Let U = active users, a = actions per user per hour, h = busy hours per day, p = peak factor, q = DB transactions per request (today about 2: one in the auth hook, one in the handler, plus the refresh), r = rows written per action, b = average bytes per stored row including indexes, f = photos per day, s = bytes per photo, d = days retained.
- Average requests per second = U x a / 3600. Peak requests per second = average x p.
- Peak database transactions per second = peak requests x q (add the refresh).
- Rows per day = U x a x h x r. Database growth per year = rows per day x 365 x b (plus about 30 to 100% for indexes and dead rows: unverified).
- Photo storage = f x s x d. Outbound photo bytes per day = views per photo x f x s.
- Log bytes per day = requests per day x lines per request x bytes per line.
- Example with invented round numbers: U = 100, a = 20, h = 10, p = 10, q = 3, r = 1, b = 200 bytes, f = 200, s = 200 KB, d = 365. Average = 0.56 requests per second in a busy hour; peak = 5.6; transactions = about 17 per second; rows per day = 20,000; database growth = 20,000 x 365 x 200 bytes = about 1.5 GB per year before overhead; photos = 200 x 200 KB = 40 MB per day, about 14.6 GB per year. The photo store is therefore about ten times the database, which is why retention and thumbnails come first.
- Reading the example: 17 transactions per second is tiny, but each refresh then costs Theta(E) with E growing by 20,000 rows a day, so after a year E is about 7 million rows and a full reload per write is no longer cheap. The scaling problem is the recompute, not the request rate.

---

## Prioritised plan

| Item | Bucket | Effort | Cost lever |
| --- | --- | --- | --- |
| Skip no-op `warning.maths` updates (`is distinct from`) | Do now | S | WAL, disk, backup size |
| Single-flight / trailing refresh; scope refresh to affected orders; one daily full pass | Do now | M | CPU, DB reads, instance size |
| Batch route: one transaction per batch with a savepoint per item | Do now | M | WAL flushes, connections, CPU |
| Release the DB connection before storage I/O; cap concurrent photo transfers; stream instead of buffering | Do now | M | Pool size, RAM, instance size |
| `connectionTimeoutMillis`, `requestTimeout`, SIGTERM graceful close, `pool.end()` | Do now | S | Stability, avoids oversizing |
| Logging at warn (or one summary line), `redact`, rotation cap | Do now | S | Log volume, disk |
| `private, no-cache` + ETag on board/review/my-stages/photos; keep `no-store` for secrets | Do now | S to M | Egress, S3 requests |
| Compression at the reverse proxy (level 4 to 6, skip under 1 KB) | Do now | S | Egress |
| Node heap flag, Postgres memory settings, `max_connections` about 20 to 30 | Do now | S | RAM, instance size |
| `pg_stat_statements` + `EXPLAIN (ANALYZE, BUFFERS)` on the `loadEngineData` queries with seeded data | Do now | S | Prevents buying capacity blindly |
| Chrony/time sync, `LimitNOFILE`, postmaster `oom_score_adj`, separate memory groups | Do now | S | Prevents outages and oversizing |
| Nightly `pg_dump` to a separate bucket with retention; restore drill | Do now | S | Backup storage, risk |
| Photo retention (remove files of shipped orders), lifecycle backstop, abort-incomplete-multipart rule | Do now | M | Storage |
| Phone-side thumbnail + image size target | Do when load grows | M | Storage, egress, S3 requests |
| Board memo keyed by data version; 304 before loading data | Do when load grows | M | CPU, egress |
| Short-lived account lookup cache in the auth hook | Do when load grows | M | DB round trips, CPU |
| Indexes: `update_event(unit_id)`, `orders(buyer_id)`, `milestone(buyer_id, unit_id)`, partial pending-photo index (CONCURRENTLY, after EXPLAIN) | Do when load grows | S each | CPU, read I/O |
| Archive closed orders; pre-aggregate events per day (with output parity test) | Do when load grows | M to L | CPU, RAM, DB size |
| Response schemas on hot GET routes | Do when load grows | M | CPU, leak safety |
| Outbox relay with `SKIP LOCKED` + retention, when alerts become real | Do when load grows | M | Reliability |
| Presigned URLs for photo reads (short expiry), only if VM outbound is the limit | Do when load grows | M | VM egress, RAM |
| Pooler (PgBouncer 1.21+ with prepared statements) or second vCPU/cluster | Do when load grows | M | Connections, CPU |
| `wal_compression`, WAL archiving for point-in-time recovery | Do when load grows | S | Backup size, recovery point |
| Table partitioning | Not worth it | L | Breaks the `client_uuid` unique key; data far below RAM |
| Read replicas | Not worth it | L | Doubles the database line, adds stale colours |
| Serverless rewrite / scale-to-zero database | Not worth it | L | Streaming photos, in-memory caches, first-sync cold start |
| `fsync=off`, `full_page_writes=off`, `synchronous_commit=off` for events | Not worth it (unsafe) | S | Risks corruption or silently lost updates |
| Multipart upload, storage-class tiering for small photos | Not worth it | M | Objects are small; tier fees and minimums erase the gain |
| Message broker / queue service | Not worth it | L | Outbox table is enough |
| GIN indexes on jsonb, materialised view for the board | Not worth it | M | No jsonb searches; refresh is a full recompute anyway |
| BRIN indexes | Not worth it | S | Top-N-by-time queries favour B-tree; data is small |
