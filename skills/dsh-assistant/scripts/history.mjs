/** Passive backward paging. Protocol verified against DSH 0.2.2-rc.3
 * dsh-api-session-controller/src/types.ts SessionPageRequest/SessionPage and
 * src/history.ts paginate: beforeSeq is exclusive, throughSeq is inclusive.
 * Throw on incomplete/unsupported reads; callers must never accept partial evidence.
 */
export async function readHistory(client, sessionId, { afterSeq = -1, maxPages = 100, maxMessages = 100 } = {}) {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < -1) throw new Error('Invalid history afterSeq');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('Invalid history maxPages');
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) throw new Error('Invalid history maxMessages');
  const records = new Map();
  let beforeSeq;
  let throughSeq;
  for (let pages = 1; pages <= maxPages; pages += 1) {
    const page = await client.readSessionPage(sessionId, { maxMessages,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      ...(throughSeq === undefined ? {} : { throughSeq }) });
    if (!Array.isArray(page?.records) || typeof page.hasMore !== 'boolean') {
      throw new Error('Unsupported DSH history page protocol: records/hasMore missing');
    }
    let minimum = Infinity;
    let maximum = -1;
    for (const record of page.records) {
      const seq = record?.event?.seq;
      if (record?.type !== 'event' || !Number.isSafeInteger(seq) || seq < 0) throw new Error('Invalid DSH history event sequence');
      if (throughSeq !== undefined && seq > throughSeq) throw new Error('DSH history exceeded pinned log cut');
      minimum = Math.min(minimum, seq);
      maximum = Math.max(maximum, seq);
      const previous = records.get(seq);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error('Conflicting DSH history duplicate');
      records.set(seq, record);
    }
    if (throughSeq === undefined) throughSeq = maximum;
    if (beforeSeq !== undefined && minimum >= beforeSeq) throw new Error('DSH history pagination made no progress');
    if (page.hasMore && !page.records.length) throw new Error('DSH history pagination empty with more history');
    if (!page.hasMore || minimum <= afterSeq + 1) {
      const ordered = [...records.values()].filter(r => r.event.seq > afterSeq).sort((a,b) => a.event.seq-b.event.seq);
      let expected = afterSeq + 1;
      for (const record of ordered) {
        if (record.event.seq !== expected) throw new Error('DSH history incomplete: event sequence gap');
        expected += 1;
      }
      return { records: ordered,
        hasMore: false, pages, throughSeq };
    }
    beforeSeq = minimum;
  }
  throw new Error(`DSH history incomplete: maxPages (${maxPages}) exhausted`);
}
