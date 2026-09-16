// Shared response and value shapes used across the API controllers and models,
// so their exported signatures do not repeat anonymous inline object types.

export interface Position {
  x: number;
  y: number;
}

export interface SuccessResponse {
  success: boolean;
}

export interface ListResult<T> {
  items: T[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}
