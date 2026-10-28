/**
 * Alias dei tipi binari usati nel protocollo.
 * Web Crypto, Blob e DataChannel richiedono viste su ArrayBuffer (non su
 * SharedArrayBuffer): il tipo esplicito evita ambiguità nelle API del DOM.
 */
export type Bytes = Uint8Array<ArrayBuffer>;
