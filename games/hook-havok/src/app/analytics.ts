import { startGameAnalytics, createPlayMetrics } from "fuse-ui/play-metrics";
export const analytics = startGameAnalytics("hook-havok");
export const reportPlay = createPlayMetrics(analytics.track, () =>
  performance.now(),
);
