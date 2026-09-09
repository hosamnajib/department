// Data access layer. Owns every SQL statement for the two resources, validates
// input, and raises typed errors the HTTP layer maps straight onto the SS-5
// envelope. Reads return a value or null (a missing row is an ordinary
// answer); writes raise when they change nothing (SS-15).

const { query } = require('./db');

class RepoError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'RepoError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
class NotFoundError extends RepoError {
  constructor(message) {
    super(404, 'RESOURCE_NOT_FOUND', message);
  }
}
class ConflictError extends RepoError {
  constructor(message) {
    super(409, 'CONFLICT', message);
  }
}
class ValidationError extends RepoError {
  constructor(message, details) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

const VALID_STATUS = new Set(['Active', 'Inactive']);
const asStatus = (v) => (VALID_STATUS.has(v) ? v : 'Active');
const asId = (v) => String(v == null ? '' : v).trim();
const asText = (v) => String(v == null ? '' : v).trim();

// Translate a mysql2 driver error into one of ours; anything unrecognised is
// re-thrown and becomes a genuine 500.
function translate(err, ctx) {
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      return new ConflictError(`A ${ctx.kind} with id '${ctx.id}' already exists.`);
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new ValidationError(`Supervisor '${ctx.supervisorId}' does not exist.`, {
        fields: ['supervisorId']
      });
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new ConflictError('That supervisor is still assigned to one or more departments.');
    case 'ER_DATA_TOO_LONG':
      return new ValidationError('One of the values is too long.');
    default:
      return err;
  }
}

// --- Departments -----------------------------------------------------------

const DEPT_COLS = 'id, name, supervisorId, status';

const departments = {
  list() {
    return query(`SELECT ${DEPT_COLS} FROM departments ORDER BY id ASC`);
  },

  async get(id) {
    const rows = await query(`SELECT ${DEPT_COLS} FROM departments WHERE id = ?`, [asId(id)]);
    return rows[0] || null;
  },

  async create(input) {
    const id = asId(input.id);
    const name = asText(input.name);
    const supervisorId = asId(input.supervisorId) || null;
    if (!id || !name) {
      throw new ValidationError('A department id and name are required.', { fields: ['id', 'name'] });
    }
    try {
      await query('INSERT INTO departments (id, name, supervisorId, status) VALUES (?, ?, ?, ?)', [
        id,
        name,
        supervisorId,
        asStatus(input.status)
      ]);
    } catch (err) {
      throw translate(err, { kind: 'department', id, supervisorId });
    }
    return departments.get(id);
  },

  async update(id, input) {
    const key = asId(id);
    const name = asText(input.name);
    const supervisorId = asId(input.supervisorId) || null;
    if (!name) throw new ValidationError('A department name is required.', { fields: ['name'] });

    let result;
    try {
      result = await query('UPDATE departments SET name = ?, supervisorId = ?, status = ? WHERE id = ?', [
        name,
        supervisorId,
        asStatus(input.status),
        key
      ]);
    } catch (err) {
      throw translate(err, { kind: 'department', id: key, supervisorId });
    }
    if (result.affectedRows === 0) throw new NotFoundError(`No department with id '${key}'.`);
    return departments.get(key);
  },

  async remove(id) {
    const key = asId(id);
    const result = await query('DELETE FROM departments WHERE id = ?', [key]);
    if (result.affectedRows === 0) throw new NotFoundError(`No department with id '${key}'.`);
  }
};

// --- Supervisors ---------------------------------------------------------------

const SUP_COLS = 'id, firstName, lastName, email, status';

const supervisors = {
  list() {
    return query(`SELECT ${SUP_COLS} FROM supervisors ORDER BY id ASC`);
  },

  async get(id) {
    const rows = await query(`SELECT ${SUP_COLS} FROM supervisors WHERE id = ?`, [asId(id)]);
    return rows[0] || null;
  },

  async create(input) {
    const id = asId(input.id);
    const firstName = asText(input.firstName);
    const lastName = asText(input.lastName);
    if (!id || !firstName || !lastName) {
      throw new ValidationError('A supervisor id, first name and last name are required.', {
        fields: ['id', 'firstName', 'lastName']
      });
    }
    try {
      await query('INSERT INTO supervisors (id, firstName, lastName, email, status) VALUES (?, ?, ?, ?, ?)', [
        id,
        firstName,
        lastName,
        asText(input.email),
        asStatus(input.status)
      ]);
    } catch (err) {
      throw translate(err, { kind: 'supervisor', id });
    }
    return supervisors.get(id);
  },

  async update(id, input) {
    const key = asId(id);
    const firstName = asText(input.firstName);
    const lastName = asText(input.lastName);
    if (!firstName || !lastName) {
      throw new ValidationError('A supervisor first name and last name are required.', {
        fields: ['firstName', 'lastName']
      });
    }
    const result = await query(
      'UPDATE supervisors SET firstName = ?, lastName = ?, email = ?, status = ? WHERE id = ?',
      [firstName, lastName, asText(input.email), asStatus(input.status), key]
    );
    if (result.affectedRows === 0) throw new NotFoundError(`No supervisor with id '${key}'.`);
    return supervisors.get(key);
  },

  async remove(id) {
    const key = asId(id);
    const result = await query('DELETE FROM supervisors WHERE id = ?', [key]);
    if (result.affectedRows === 0) throw new NotFoundError(`No supervisor with id '${key}'.`);
  }
};

module.exports = { departments, supervisors, RepoError, NotFoundError, ConflictError, ValidationError };
