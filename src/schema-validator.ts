// ─── Inline JSON Schema Validator ─────────────────────────────────────

type SchemaErrors = string[];

export function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
  path = '$',
): SchemaErrors {
  const errors: SchemaErrors = [];

  if (typeof schema !== 'object' || schema === null) return errors;

  // type check
  if (typeof schema['type'] === 'string') {
    const expected = schema['type'] as string;
    const actual = typeof data;
    if (data === null && expected !== 'null') {
      errors.push(`${path}: expected ${expected}, got null`);
    } else if (expected === 'integer') {
      if (!Number.isInteger(data)) {
        errors.push(`${path}: expected integer, got ${actual} (${JSON.stringify(data)})`);
      }
    } else if (expected === 'number') {
      if (typeof data !== 'number') {
        errors.push(`${path}: expected number, got ${actual}`);
      }
    } else if (expected === 'array') {
      if (!Array.isArray(data)) {
        errors.push(`${path}: expected array, got ${actual}`);
      }
    } else if (expected === 'object') {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        errors.push(`${path}: expected object, got ${actual}`);
      }
    } else if (expected !== actual) {
      errors.push(`${path}: expected ${expected}, got ${actual}`);
    }
  }

  // required fields
  if (
    Array.isArray(schema['required']) &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data)
  ) {
    for (const req of schema['required'] as string[]) {
      if (!(req in data)) {
        errors.push(`${path}: missing required field "${req}"`);
      }
    }
  }

  // properties
  if (
    typeof schema['properties'] === 'object' &&
    schema['properties'] !== null &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data)
  ) {
    const props = schema['properties'] as Record<string, unknown>;
    for (const [key, subSchema] of Object.entries(props)) {
      if (key in data && typeof subSchema === 'object' && subSchema !== null) {
        const subErrors = validateJsonSchema(
          (data as Record<string, unknown>)[key],
          subSchema as Record<string, unknown>,
          `${path}.${key}`,
        );
        errors.push(...subErrors);
      }
    }
  }

  // minimum / maximum (numbers)
  if (typeof schema['minimum'] === 'number' && typeof data === 'number') {
    if (data < (schema['minimum'] as number)) {
      errors.push(`${path}: ${data} is less than minimum ${schema['minimum']}`);
    }
  }
  if (typeof schema['maximum'] === 'number' && typeof data === 'number') {
    if (data > (schema['maximum'] as number)) {
      errors.push(`${path}: ${data} is greater than maximum ${schema['maximum']}`);
    }
  }

  // minLength / maxLength (strings)
  if (typeof schema['minLength'] === 'number' && typeof data === 'string') {
    if (data.length < (schema['minLength'] as number)) {
      errors.push(`${path}: length ${data.length} is less than minLength ${schema['minLength']}`);
    }
  }
  if (typeof schema['maxLength'] === 'number' && typeof data === 'string') {
    if (data.length > (schema['maxLength'] as number)) {
      errors.push(
        `${path}: length ${data.length} is greater than maxLength ${schema['maxLength']}`,
      );
    }
  }

  return errors;
}
