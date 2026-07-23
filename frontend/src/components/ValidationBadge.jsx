import React, { useState } from 'react';
import { Check, AlertCircle, ChevronDown, Loader2 } from 'lucide-react';

const DEFAULT_MAX_COORDS_PER_RULE = 8;

const truncateValidationLine = (line, maxCoordsPerRule) => {
  if (typeof line !== 'string') return '';

  const separatorIndex = line.indexOf(':');
  if (separatorIndex < 0) return line;

  const ruleSpec = line.slice(0, separatorIndex + 1);
  const coordinates = line.slice(separatorIndex + 1);
  const totalCoordinates = coordinates
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean).length;

  let commaCount = 0;
  let truncationIndex = -1;
  for (let idx = 0; idx < coordinates.length; idx += 1) {
    if (coordinates[idx] === ',') {
      commaCount += 1;
      if (commaCount === maxCoordsPerRule) {
        truncationIndex = idx;
      }
    }
  }

  if (commaCount <= maxCoordsPerRule || truncationIndex < 0) {
    return line;
  }

  const truncatedCoordinates = coordinates.slice(0, truncationIndex).trimEnd();
  return `${ruleSpec}${truncatedCoordinates}, ... (${totalCoordinates} total)`;
};

export default function ValidationBadge({ validationSummary, maxCoordsPerRule = DEFAULT_MAX_COORDS_PER_RULE }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!validationSummary) return null;

  const isValid = validationSummary.status === 'valid';
  const isValidating = validationSummary.status === 'validating';
  const parsedMaxCoordsPerRule = Number(maxCoordsPerRule);
  const effectiveMaxCoordsPerRule = Number.isInteger(parsedMaxCoordsPerRule) && parsedMaxCoordsPerRule > 0
    ? parsedMaxCoordsPerRule
    : DEFAULT_MAX_COORDS_PER_RULE;
  const errorLines = validationSummary.title
    .split('\n')
    .filter(line => line.trim())
    .map((line) => truncateValidationLine(line, effectiveMaxCoordsPerRule));

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded text-xs font-medium transition-all ${
          isValidating
            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            : isValid
            ? 'bg-green-100 text-green-800 hover:bg-green-200'
            : 'bg-red-100 text-red-800 hover:bg-red-200'
        }`}
      >
        {isValidating ? <Loader2 size={12} className="animate-spin" /> : (isValid ? <Check size={12} /> : <AlertCircle size={12} />)}
        <span>{validationSummary.label}</span>
        <ChevronDown
          size={14}
          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && errorLines.length > 0 && (
        <div style={{ zIndex: 100}} className={`absolute top-full right-0 mt-2 p-3 rounded border text-xs w-max max-w-md z-10 ${
          isValidating
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : isValid
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="space-y-1">
            {errorLines.map((line, idx) => (
              <div key={idx} className="whitespace-pre-wrap font-mono">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {isExpanded && errorLines.length === 0 && (
        <div className={`absolute top-full right-0 mt-2 p-3 rounded border text-xs w-max max-w-md z-10 ${
          isValidating
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : isValid
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div>{isValidating ? 'Validation is currently in progress.' : 'No validation issues to display.'}</div>
        </div>
      )}
    </div>
  );
}