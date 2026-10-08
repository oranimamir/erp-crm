/**
 * What documents are filed under: an operation or a non-commercial operation.
 * The shared document components (shipping document tiles, choose from the
 * system, add from library, edit, declarations) take one of these.
 */
export type DocOwner = { kind: 'operation' | 'nco'; id: number };

/** API base for the owner's own routes: /operations/12 or /non-commercial-operations/5 */
export const ownerApi = (o: DocOwner) => (o.kind === 'nco' ? `/non-commercial-operations/${o.id}` : `/operations/${o.id}`);

/** The owner as request params / body fields: { operation_id } or { nco_id } */
export const ownerParams = (o: DocOwner): Record<string, number> => (o.kind === 'nco' ? { nco_id: o.id } : { operation_id: o.id });

/** The same as a query string: operation_id=12 or nco_id=5 */
export const ownerQuery = (o: DocOwner) => (o.kind === 'nco' ? `nco_id=${o.id}` : `operation_id=${o.id}`);

/** Where the owner's page is. */
export const ownerPage = (o: DocOwner) => (o.kind === 'nco' ? `/non-commercial-operations/${o.id}` : `/operations/${o.id}`);
