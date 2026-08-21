const CLAIM_STATUSES_REQUIRING_PUBLIC_CONTENT = new Set(['confirmed', 'disputed']);

export const PUBLIC_CONTENT_READINESS_POLICY = Object.freeze([
  Object.freeze({ field: 'origin', requires: strainData => claimRequiresPublicContent(strainData?.origin) }),
  Object.freeze({ field: 'lineageNote', requires: strainData => claimRequiresPublicContent(strainData?.lineage) }),
  Object.freeze({ field: 'history', requires: strainData => claimRequiresPublicContent(strainData?.history) }),
  Object.freeze({ field: 'aromaNote', requires: strainData => hasClaimItems(strainData?.aromas) }),
  Object.freeze({ field: 'terpeneNote', requires: strainData => hasClaimItems(strainData?.terpenes) })
]);

function claimRequiresPublicContent(claim) {
  return Boolean(claim && CLAIM_STATUSES_REQUIRING_PUBLIC_CONTENT.has(claim.status));
}

function hasClaimItems(claim) {
  return Boolean(claim && Array.isArray(claim.items) && claim.items.length > 0);
}

function hasPublicText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateProductionReadiness(strainData) {
  if (!strainData || typeof strainData !== 'object' || Array.isArray(strainData)) {
    return {
      ready: false,
      status: 'NOT_PROMOTABLE',
      reasons: ['STRAIN_DATA_INVALID']
    };
  }

  const ja = strainData.publicContent?.ja;
  const reasons = [];
  for (const rule of PUBLIC_CONTENT_READINESS_POLICY) {
    if (rule.requires(strainData) && !hasPublicText(ja?.[rule.field])) {
      reasons.push(`PUBLIC_CONTENT_MISSING:${rule.field}`);
    }
  }

  return {
    ready: reasons.length === 0,
    status: reasons.length === 0 ? 'PROMOTABLE' : 'NOT_PROMOTABLE',
    reasons
  };
}

export function assertProductionReady(strainData, label = 'candidate') {
  const result = evaluateProductionReadiness(strainData);
  if (!result.ready) {
    const error = new Error(`PRODUCTION_READINESS_FAIL ${label}: ${result.reasons.join(',')}`);
    error.code = 'PRODUCTION_READINESS_FAIL';
    error.reasons = result.reasons;
    throw error;
  }
  return result;
}
