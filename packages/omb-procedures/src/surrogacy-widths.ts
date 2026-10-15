/** Frozen on pilot seeds only, before any round-2 release result. */
export const SURROGACY_WIDTHS={
  "bands": [
    {
      "min": 10,
      "max": 14,
      "slopeFactor": 1.5,
      "correlationFactor": 1.25
    },
    {
      "min": 15,
      "max": 24,
      "slopeFactor": 1.45,
      "correlationFactor": 1.25
    },
    {
      "min": 25,
      "max": 49,
      "slopeFactor": 1.5,
      "correlationFactor": 1.35
    },
    {
      "min": 50,
      "max": 100,
      "slopeFactor": 1.35,
      "correlationFactor": 1.35
    }
  ],
  "outsideBandFactor": 2,
  "pilotSelectionHash": "9c7a9aa37c42fe4d67babfa1d553d30be4299a201316c72a2386518090f1a899"
} as const;
export function surrogateWidths(n:number){return SURROGACY_WIDTHS.bands.find(b=>n>=b.min&&n<=b.max)??{min:n,max:n,slopeFactor:SURROGACY_WIDTHS.outsideBandFactor,correlationFactor:SURROGACY_WIDTHS.outsideBandFactor};}
