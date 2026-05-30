import { ParameterValidator } from '../validation.js';

describe('ParameterValidator.validateQueryParameters (named params)', () => {
  it('defaults namedParams to an empty object when params is omitted', () => {
    const r = ParameterValidator.validateQueryParameters({ query: 'SELECT 1' });
    expect(r.namedParams).toEqual({});
  });

  it('accepts scalar param values (string, number, boolean, null)', () => {
    const r = ParameterValidator.validateQueryParameters({
      query: 'SELECT * FROM t WHERE DATEDIFF(YEAR, x, @as_of) >= @years AND active = @on AND note = @none',
      params: { as_of: '2026-05-30', years: 3, on: true, none: null },
    });
    expect(r.namedParams).toEqual({ as_of: '2026-05-30', years: 3, on: true, none: null });
  });

  it('rejects an invalid parameter name', () => {
    expect(() =>
      ParameterValidator.validateQueryParameters({ query: 'SELECT 1', params: { 'bad name': 1 } }),
    ).toThrow();
  });

  it('rejects a non-scalar parameter value', () => {
    expect(() =>
      ParameterValidator.validateQueryParameters({ query: 'SELECT 1', params: { x: { nested: 1 } } }),
    ).toThrow();
    expect(() =>
      ParameterValidator.validateQueryParameters({ query: 'SELECT 1', params: { x: [1, 2] } }),
    ).toThrow();
  });
});
