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

  // Reported from live use against the published 2.0.7 build, whose
  // containsSqlInjectionPatterns() gate was removed in c5cb825. Locked in here so
  // the gate cannot be reintroduced.
  describe('reported false positives (published 2.0.7 regressions)', () => {
    it('allows <= and >= comparison operators', () => {
      valid(`SELECT COUNT(*) FROM t WHERE Datestamp <= GETDATE()`);
      valid(`SELECT COUNT(*) FROM t WHERE Datestamp >= GETDATE()`);
    });

    it('allows a trailing semicolon after a comparison (the real 2.0.7 date-range trigger)', () => {
      valid(`SELECT COUNT(*) FROM t WHERE Datestamp <= GETDATE();`);
    });

    it('allows a quoted literal immediately followed by AND / OR', () => {
      valid(`SELECT * FROM t WHERE x = 'abc' AND y = 1`);
      valid(`SELECT * FROM t WHERE d > '2026-03-01' AND z = 1`);
      valid(`SELECT * FROM t WHERE x = 'abc' OR y = 1`);
    });

    it('allows a quoted date literal inside a function call', () => {
      valid(`SELECT CAST('2026-07-07' AS date)`);
      valid(`SELECT * FROM t WHERE d >= CAST('2026-07-07' AS date) AND x = 1`);
    });

    it('allows several chained OR ... LIKE predicates', () => {
      valid(`SELECT * FROM t WHERE Changes LIKE '%a%' OR Changes LIKE '%b%' OR Changes LIKE '%c%'`);
    });

    it('allows CHAR() / NCHAR() as ordinary builtins', () => {
      valid(`SELECT CHAR(9) + name + CHAR(10) FROM t`);
      valid(`SELECT NCHAR(233) FROM t`);
    });

    it('allows @@ system variables', () => {
      valid(`SELECT @@ROWCOUNT`);
    });

    it('allows a large multi-CTE query with NOT IN / NOT EXISTS subqueries', () => {
      valid(
        `WITH a AS (SELECT id FROM x WHERE t = 'p' AND n = 1),
              b AS (SELECT id FROM y WHERE id NOT IN (SELECT id FROM a))
         SELECT * FROM b WHERE NOT EXISTS (SELECT 1 FROM a WHERE a.id = b.id)`
      );
    });

    it('allows BETWEEN <number> AND <number>', () => {
      valid(`SELECT * FROM Orders WHERE Total BETWEEN 1 AND 100`);
    });
  });

  describe('confirmed-passing regression cases', () => {
    it('allows a bare COUNT(*)', () => valid(`SELECT COUNT(*) FROM t`));
    it('allows a numeric comparison', () => valid(`SELECT * FROM t WHERE Quantity > 0`));
    it('allows AND with a DATEADD window', () => {
      valid(`SELECT * FROM t WHERE Quantity > 0 AND Datestamp > DATEADD(day,-30,GETDATE())`);
    });
    it('allows a trailing quoted literal', () => {
      valid(`SELECT * FROM t WHERE DAY(Datestamp) = 1 AND ServiceGroup = 'Sportspick'`);
    });
    it('allows window functions and CASE', () => {
      valid(`SELECT CASE WHEN q > 0 THEN 1 ELSE 0 END, ROW_NUMBER() OVER (ORDER BY id) FROM t`);
    });
  });

  // These are *not* blocked, deliberately. The caller authors the whole query;
  // there is no trusted template into which untrusted input is concatenated, so a
  // tautology or a UNION cannot escalate anything a plain SELECT could not already
  // do. Blocking them requires the /\bOR\s+\d/ and /UNION.*SELECT/ patterns that
  // caused the false positives above. Confidentiality is enforced by the DB login's
  // permissions, not by string matching.
  describe('tautologies and UNIONs are allowed (read-only threat model)', () => {
    it('allows OR 1=1 with a trailing comment', () => {
      valid(`SELECT * FROM t WHERE id = 1 OR 1=1 --`);
    });

    it('allows UNION SELECT with a trailing comment', () => {
      valid(`SELECT a FROM t WHERE id = 1 UNION SELECT b FROM u --`);
    });

    it('allows a comment that contains a would-be second statement', () => {
      // `-- ; DROP TABLE x` is a comment to SQL Server too; nothing executes.
      valid(`SELECT 1 -- ; DROP TABLE x`);
    });
  });

  // The skeleton must be built in one quote-aware pass. Stripping comments with a
  // regex *before* masking string literals lets a `--` or `/*` inside a literal
  // swallow the rest of the query, hiding a stacked statement from every check
  // while the untouched original is what actually reaches the driver.
  describe('comment/literal confusion cannot hide a statement', () => {
    it('rejects a stacked DROP hidden behind -- inside a string literal', () => {
      expect(invalid(`SELECT * FROM t WHERE a = '--'; DROP TABLE users`)).toBeDefined();
    });

    it('rejects a stacked EXEC hidden behind -- inside a URL literal', () => {
      expect(invalid(`SELECT * FROM t WHERE url = 'http://x--y'; EXEC xp_cmdshell 'dir'`)).toBeDefined();
    });

    it('rejects a stacked DROP hidden behind /* inside a string literal', () => {
      expect(invalid(`SELECT * FROM t WHERE a = '/*' ; DROP TABLE users --*/`)).toBeDefined();
    });

    it('sees a statement after a line comment terminated by a newline', () => {
      expect(invalid('SELECT 1 --\n; DROP TABLE x')).toBeDefined();
    });

    it('rejects an unterminated string literal', () => {
      expect(invalid(`SELECT * FROM t WHERE a = 'abc; DROP TABLE x`)).toMatch(/unterminated/i);
    });

    it('rejects an unterminated block comment', () => {
      expect(invalid(`SELECT 1 /* unterminated`)).toMatch(/unterminated/i);
    });

    it('still allows -- and /* as ordinary literal content', () => {
      valid(`SELECT * FROM t WHERE a = '--' AND b = '/*'`);
      valid(`SELECT * FROM t WHERE url = 'http://x--y'`);
    });
  });

  describe('genuine injection / write attempts', () => {
    it('rejects a stacked DROP', () => {
      expect(invalid(`SELECT * FROM t; DROP TABLE users`)).toBeDefined();
    });

    it('rejects xp_cmdshell by procedure-name prefix', () => {
      expect(invalid(`SELECT * FROM xp_cmdshell`)).toMatch(/forbidden/i);
    });

    it('rejects sp_ procedures by prefix', () => {
      expect(invalid(`SELECT * FROM sp_who`)).toMatch(/forbidden/i);
    });

    it('rejects WAITFOR time-based probing', () => {
      expect(invalid(`SELECT 1 WAITFOR DELAY '00:00:05'`)).toMatch(/forbidden/i);
    });

    it('rejects OPENROWSET exfiltration', () => {
      expect(invalid(`SELECT * FROM OPENROWSET('SQLNCLI','...','SELECT 1')`)).toMatch(/forbidden/i);
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
