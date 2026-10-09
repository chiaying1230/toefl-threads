// Offline stand-in for the Anthropic client (--mock): no network, fake numbers. Batches are persisted to a
// file so an interrupted run can be resumed in a new process, like the real thing.
import fs from "node:fs";

export function makeMock(respond, persistFile) {
  const load = () => (persistFile && fs.existsSync(persistFile) ? JSON.parse(fs.readFileSync(persistFile, "utf8")) : { n: 0, batches: {} });
  const save = (d) => persistFile && fs.writeFileSync(persistFile, JSON.stringify(d));
  const one = (params) => {
    const { text, usage } = respond(params);
    return { stop_reason: "end_turn", content: [{ type: "text", text }], usage };
  };
  return {
    messages: {
      create: async (params) => one(params),
      batches: {
        create: async ({ requests }) => {
          const d = load();
          const id = `msgbatch_mock_${++d.n}`;
          d.batches[id] = requests;
          save(d);
          return { id, processing_status: "in_progress" };
        },
        retrieve: async (id) => {
          if (process.env.MOCK_CRASH_AFTER_SUBMIT) { console.log("  [mock] simulated crash while waiting for the batch"); process.exit(3); }
          return { id, processing_status: "ended", request_counts: { processing: 0, succeeded: (load().batches[id] || []).length, errored: 0 } };
        },
        results: async (id) => (async function* () {
          for (const r of load().batches[id]) yield { custom_id: r.custom_id, result: { type: "succeeded", message: one(r.params) } };
        })(),
      },
    },
  };
}
