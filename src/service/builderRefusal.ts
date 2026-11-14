import type { BuilderError } from "@antelopejs/interface-dms-builder";

/**
 * Why the DMS builder refused an operation, in the builder's own terms.
 *
 * @param error The error the builder answered
 * @returns The reason, for the owner to read
 */
export function builderRefusalReason(error: BuilderError): string {
  switch (error.code) {
    case "invalid_config":
      return error.issues
        .map(({ pointer, message }) =>
          pointer === "" ? message : `${pointer} ${message}`,
        )
        .join("; ");
    case "typecheck_failed":
      return error.diagnostics
        .map(({ file, line, message }) => `${file}:${line} ${message}`)
        .join("; ");
    case "unsupported":
      return error.detail;
    case "not_found":
      return `${error.ref} was not found`;
    case "duplicate_name":
      return `the name ${error.name} is already taken in its ${error.scope}`;
    case "opaque_target":
      return `${error.path} is written by hand`;
    case "referential_integrity":
      return `still used by ${error.blockedBy.join(", ")}`;
    case "stale":
      return `${error.ref} changed since it was read`;
  }
}
