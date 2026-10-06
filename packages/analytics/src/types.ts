export type RegistryAnalyticsScope =
  | "public"
  | "administrative";

export interface AnalyticsCount {
  id: string;
  label: string;
  count: number;
}

export interface AnalyticsTimeBucket {
  start: string;
  count: number;
}

export interface AnalyticsDeadlineSummary {
  open: number;
  paused: number;
  approaching: number;
  overdue: number;
  horizonDays: number;
}

export interface AnalyticsEvidenceCoverage {
  recordCount: number;
  recordsWithEvidence: number;
  recordsWithoutEvidence: number;
  recordCoveragePercent: number;
  sourceCount: number;
  citedSourceCount: number;
  sourceCoveragePercent: number;
}

export interface AnalyticsDimensionValue {
  id: string;
  label: string;
  count: number;
}

export interface AnalyticsDimensionBreakdown {
  id: string;
  label: string;
  recordTypeId: string;
  fieldId: string;
  values: AnalyticsDimensionValue[];
  suppressedCount: number;
}

export interface RegistryAnalyticsSnapshot {
  registryId: string;
  scope: RegistryAnalyticsScope;
  generatedAt: string;
  totalRecords: number;
  publicationTrendWindowDays: number;
  changeActivityWindowDays: number;
  byRecordType: AnalyticsCount[];
  byStatus: AnalyticsCount[];
  publicationTrend: AnalyticsTimeBucket[];
  changeActivity: AnalyticsTimeBucket[];
  deadlines: AnalyticsDeadlineSummary;
  evidenceCoverage: AnalyticsEvidenceCoverage;
  dimensions: AnalyticsDimensionBreakdown[];
}

export interface RegistryAnalyticsQuery {
  scope: RegistryAnalyticsScope;
  now?: string;
}
