import { QueryValidator } from '../security.js';

describe('QueryValidator.validateQuery', () => {
  const valid = (q: string) => expect(QueryValidator.validateQuery(q).isValid).toBe(true);
  const invalid = (q: string) => {
    const r = QueryValidator.validateQuery(q);
    expect(r.isValid).toBe(false);
    return r.error;
  };

  describe('legitimate read-only queries (regression: false positives)', () => {
    it('allows multi-value IN with quoted GUIDs and a trailing semicolon', () => {
      valid(
        `SELECT c.ClientGUID, c.Name FROM CRID.dbo.Customer c
         WHERE c.ClientGUID IN ('6EC37D51-FA86-4EA1-BCC6-97F082D565D8','992F5B29-E2E8-4B91-AC52-B308A984CB0E');`
      );
    });

    it('allows OR between two string equalities', () => {
      valid(`SELECT name FROM Client WHERE name = 'Default' OR name = 'Sportspick_Comps';`);
    });

    it('allows a single GUID equality with a trailing semicolon', () => {
      valid(`SELECT Name FROM Client WHERE GUID = '6EC37D51-FA86-4EA1-BCC6-97F082D565D8';`);
    });

    it('allows a bracketed identifier such as [show]', () => {
      valid(`SELECT c.Name, c.[show] FROM Customer c WHERE c.GUID = '6EC37D51-FA86-4EA1-BCC6-97F082D565D8';`);
    });

    it('allows AND combining two string equalities', () => {
      valid(`SELECT l.Name FROM Lookup l WHERE l.Type = 'Position' AND l.Name = 'Manager';`);
    });

    it('allows AND with aggregate + GROUP BY', () => {
      valid(
        `SELECT l.GUID, COUNT(ccp.PositionGUID) AS uses FROM Lookup l
         LEFT JOIN ContactCustomerPosition ccp ON ccp.PositionGUID = l.GUID
         WHERE l.Type = 'Position' AND l.Name = 'Manager' GROUP BY l.GUID;`
      );
    });

    it('allows BETWEEN ... AND <number>', () => {
      valid(`SELECT * FROM Orders WHERE Total BETWEEN 1 AND 100`);
    });

    it('allows a forbidden word that appears only inside a string literal', () => {
      valid(`SELECT id FROM Notes WHERE body = 'we will DELETE this later'`);
    });

    it("allows escaped quotes inside a literal (O''Brien)", () => {
      valid(`SELECT id FROM Person WHERE name = 'O''Brien' AND active = 'Y'`);
    });

    it('allows UNION between two SELECTs (a read-only operation)', () => {
      valid(`SELECT id FROM A UNION SELECT id FROM B`);
    });

    it('allows WITH (CTE)', () => {
      valid(`WITH t AS (SELECT id FROM A) SELECT * FROM t WHERE id = '1' OR id = '2'`);
    });
  });

  describe('genuinely disallowed queries', () => {
    it('rejects an empty query', () => {
      expect(invalid('   ')).toMatch(/empty/i);
    });

    it('rejects a non-SELECT leading statement', () => {
      expect(invalid('DELETE FROM Users')).toMatch(/must start with/i);
    });

    it('does not treat SELECTOR-style identifiers as SELECT', () => {
      expect(invalid('SELECTED FROM x')).toMatch(/must start with/i);
    });

    it('rejects forbidden write keywords in the statement body', () => {
      expect(invalid('SELECT 1; DROP TABLE Users')).toBeDefined();
      expect(invalid('SELECT * FROM x WHERE id IN (SELECT id FROM y); DELETE FROM y')).toBeDefined();
    });

    it('rejects EXEC / stored-proc execution', () => {
      expect(invalid('SELECT * FROM x WHERE 1=1 EXEC sp_who')).toMatch(/forbidden/i);
    });

    it('rejects multiple statements even without forbidden keywords', () => {
      expect(invalid(`SELECT 1; SELECT 2`)).toMatch(/multiple statements/i);
    });

    it('rejects a forbidden keyword hidden by a comment split', () => {
      expect(invalid('SELECT * FROM x; DR/**/OP TABLE y')).toBeDefined();
    });
  });
});
