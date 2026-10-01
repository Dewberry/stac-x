/**
 * The review queue on the Admin page.
 *
 * MOCK, like areas.ts. Only the gages exist as parquet today, so the queue
 * would be three rows long. These are the South Platte collections from
 * areas.ts as they'd look partway through review: some new in Development,
 * some sent back, a couple through to Production. An entry whose id the
 * catalog holds in an environment is skipped there, so real collections
 * always win. Delete entries as real collections land.
 *
 * A decision on a mock row only changes the page you're looking at; there's
 * no file behind it to write a sidecar beside.
 *
 * Times are hours before now, so the queue's ages don't go stale.
 */

import type { EnvKey } from "@/lib/env";
import type { AreaKind } from "@/lib/kinds";
import type { QcStatus } from "@/lib/stac";

export type MockReview = {
  id: string;
  title: string;
  kind: AreaKind;
  version: string | null;
  older?: boolean;
  itemCount: number;
  files: string[];
  /** The QC state in each environment the collection has reached. */
  in: Partial<Record<EnvKey, { qc: QcStatus; hoursAgo: number; note?: string }>>;
};

export const MOCK_REVIEWS: MockReview[] = [
  {
    id: "south-platte-hms",
    title: "South Platte HMS",
    kind: "hms",
    version: "v1",
    itemCount: 1000,
    files: ["south-platte-hms.parquet"],
    in: { dev: { qc: "pending", hoursAgo: 26 } },
  },
  {
    id: "denver-metro-ras-v3",
    title: "Denver metro 2D",
    kind: "ras",
    version: "v3",
    itemCount: 1000,
    files: ["denver-metro-ras-v3.parquet"],
    in: { dev: { qc: "pending", hoursAgo: 5 } },
  },
  {
    id: "denver-metro-ras-v2",
    title: "Denver metro 2D",
    kind: "ras",
    version: "v2",
    older: true,
    itemCount: 1000,
    files: ["denver-metro-ras-v2.parquet"],
    in: {
      dev: { qc: "approved", hoursAgo: 330, note: "Boundary conditions match the gage record at Henderson." },
      test: { qc: "needs_revision", hoursAgo: 190, note: "Breakline along Cherry Creek is missing below Speer. Mesh leaks across it in events 412 and 588." },
    },
  },
  {
    id: "clear-creek-ras",
    title: "Clear Creek",
    kind: "ras",
    version: null,
    itemCount: 742,
    files: ["clear-creek-ras.parquet"],
    in: {
      dev: { qc: "approved", hoursAgo: 120, note: "Spot-checked 40 events against the HMS inflows." },
      test: { qc: "pending", hoursAgo: 119 },
    },
  },
  {
    id: "cache-la-poudre-hms",
    title: "Cache la Poudre",
    kind: "hms",
    version: null,
    itemCount: 1000,
    files: ["cache-la-poudre-hms.parquet"],
    in: { dev: { qc: "pending", hoursAgo: 220 } },
  },
  {
    id: "big-thompson-ras",
    title: "Big Thompson",
    kind: "ras",
    version: null,
    itemCount: 618,
    files: ["big-thompson-ras.parquet"],
    in: {
      dev: { qc: "rejected", hoursAgo: 75, note: "Built on the 2013 terrain. Needs the post-flood lidar before it's worth reviewing." },
    },
  },
  {
    id: "chatfield-ressim",
    title: "Chatfield and Cherry Creek",
    kind: "ressim",
    version: null,
    itemCount: 1000,
    files: ["chatfield-ressim.parquet"],
    in: {
      dev: { qc: "approved", hoursAgo: 900, note: "Release rules checked against the Corps water control manual." },
      test: { qc: "approved", hoursAgo: 640, note: "Pool elevations within 0.2 ft of the observed record for 2015 to 2023." },
      prod: { qc: "approved", hoursAgo: 600, note: "Published after sign-off from the reservoir team." },
    },
  },
  {
    id: "south-platte-storms",
    title: "South Platte storm catalog",
    kind: "storms",
    version: null,
    itemCount: 1000,
    files: ["south-platte-storms.parquet"],
    in: {
      dev: { qc: "approved", hoursAgo: 500, note: "Storm centers and depths agree with NOAA Atlas 14 for the 100-year." },
      test: { qc: "approved", hoursAgo: 410, note: "Every storm opens and transposes cleanly." },
      prod: { qc: "pending", hoursAgo: 409 },
    },
  },
  {
    id: "south-platte-hms-calibration",
    title: "South Platte HMS calibration events",
    kind: "hms",
    version: null,
    itemCount: 14,
    files: ["south-platte-hms-calibration.parquet"],
    in: { dev: { qc: "needs_revision", hoursAgo: 48, note: "Two of the fourteen events point at the wrong met model." } },
  },
];
