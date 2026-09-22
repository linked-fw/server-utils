/**
 * Shape metadata types for CMS UI.
 * These types describe shape structure for frontend display — no graph-runtime dependency.
 */
import type { PathExpr } from '@_linked/core/paths/PropertyPathExpr';
export type { PathExpr };
export type PropertyDetails = {
    id: string;
    label: string;
    path: PathExpr;
    valueShape?: {
        id: string;
    };
    datatype?: {
        id: string;
    };
    description: string;
    maxCount?: number;
    minCount?: number;
    nodeKind?: {
        id: string;
    };
    name?: string;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minInclusive?: number;
    maxInclusive?: number;
    minExclusive?: number;
    maxExclusive?: number;
    inValues?: {
        id: string;
        label: string;
    }[];
};
export type ShapeDetails = {
    id: string;
    label: string;
    description: string;
    targetClass?: {
        id: string;
    };
    type?: {
        id: string;
    };
    extends?: {
        id: string;
    };
    properties: PropertyDetails[];
    numInstances?: number;
};
