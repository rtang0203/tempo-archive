import { boss, db, IMPORT_QUEUE, type ImportJobData, trackSources } from "../server/context";
import { runImport } from "../server/imports";
import { libraryFor } from "../server/users";

const b = await boss();
const sources = trackSources();

await b.work<ImportJobData>(IMPORT_QUEUE, { localConcurrency: 2 }, async ([job]) => {
  const started = Date.now();
  console.log(`import ${job!.data.jobId} started`);
  await runImport(db(), sources, job!.data.jobId, (ownerId) => libraryFor(db(), ownerId));
  console.log(`import ${job!.data.jobId} finished in ${Math.round((Date.now() - started) / 1000)}s`);
});

console.log("worker listening on", IMPORT_QUEUE);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await b.stop({ graceful: true });
    process.exit(0);
  });
}
