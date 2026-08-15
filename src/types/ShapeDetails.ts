/**
 * Shape metadata types for CMS UI.
 * These types describe shape structure for frontend display — no graph-runtime dependency.
 */

export type PropertyDetails = {
  id: string;
  label: string;
  path: { id: string } | { id: string }[];
  valueShape?: { id: string };
  datatype?: { id: string };
  description: string;
  maxCount?: number;
  minCount?: number;
  nodeKind?: { id: string };
  name?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  /** SHACL-authored presentation order for derived editor controls. */
  order?: number;
  /** IRI of the SHACL PropertyGroup that owns this property. */
  group?: string;
  /** Declared fallback shown without materializing stored data. */
  defaultValue?: unknown;
  /** SHACL-fixed value; derived controls must not present it as editable. */
  hasValue?: { id: string } | string | number | boolean;
  inValues?: { id: string; label: string }[];
};

export type ShapeDetails = {
  id: string;
  label: string;
  description: string;
  targetClass?: { id: string };
  type?: { id: string };
  extends?: { id: string };
  properties: PropertyDetails[];
  numInstances?: number;
};
