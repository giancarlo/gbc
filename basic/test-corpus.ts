export interface CompatibilityCase {
	readonly id: string;
	readonly name: string;
	readonly source: string;
}

export const compatibilityCases = [
	{
		"id": "001-parse-comments",
		"name": "parse comments",
		"source": "' This is a comment\n"
	},
	{
		"id": "002-parse-empty-comments",
		"name": "parse empty comments",
		"source": "'\n"
	},
	{
		"id": "003-parse-numbers",
		"name": "parse numbers",
		"source": "123.2"
	},
	{
		"id": "004-parse-negative-numbers",
		"name": "parse negative numbers",
		"source": "-123"
	},
	{
		"id": "005-parse-strings",
		"name": "parse strings",
		"source": "\"This is a string\\\" with escape sequence\""
	},
	{
		"id": "006-parse-identifiers",
		"name": "parse identifiers",
		"source": " RNDID$  "
	},
	{
		"id": "007-parse-assignment",
		"name": "parse assignment",
		"source": "var$ = 10"
	},
	{
		"id": "008-parse-function-without-parameter",
		"name": "parse function without parameter",
		"source": " RND()  "
	},
	{
		"id": "009-parse-function-with-single-parameter",
		"name": "parse function with single parameter",
		"source": " FN2(1)  "
	},
	{
		"id": "010-parse-addition",
		"name": "parse addition",
		"source": "var + 10"
	},
	{
		"id": "011-parse-substraction",
		"name": "parse substraction",
		"source": "var - 10"
	},
	{
		"id": "012-parse-substraction-in-parenthesis",
		"name": "parse substraction in parenthesis",
		"source": "(_HEIGHT()-1)"
	},
	{
		"id": "013-parse-multiplication",
		"name": "parse multiplication",
		"source": "var * 10"
	},
	{
		"id": "014-parse-division",
		"name": "parse division",
		"source": "var / 10"
	},
	{
		"id": "015-parse-function-call",
		"name": "parse function call",
		"source": "INT(0)"
	},
	{
		"id": "016-parse-and",
		"name": "parse AND",
		"source": "var AND 10"
	},
	{
		"id": "017-parse-expression-group",
		"name": "parse expression group",
		"source": "a * (20 + var)"
	},
	{
		"id": "018-parse-expressions",
		"name": "parse expressions",
		"source": "INT(RND(1) * x) + 1"
	},
	{
		"id": "019-parse-identifier-suffix",
		"name": "parse identifier suffix",
		"source": "hello#"
	},
	{
		"id": "020-parse-labels",
		"name": "parse labels",
		"source": "hello:\nlabel2:"
	},
	{
		"id": "021-parse-data-labels",
		"name": "parse data labels",
		"source": "normal: DATA 14\nlabel2: DATA 15"
	},
	{
		"id": "022-parse-line-numbers",
		"name": "parse line numbers",
		"source": "10 PRINT\n20 PRINT\n\t 30 PRINT"
	},
	{
		"id": "023-parse-built-in-procedures",
		"name": "parse built-in procedures",
		"source": "PLAY \"Hello\""
	},
	{
		"id": "024-parse-built-in-with-multiple-params",
		"name": "parse built-in with multiple params",
		"source": "PSET (x, y), SUNATTR"
	},
	{
		"id": "025-parse-assignment-with-group",
		"name": "parse assignment with group",
		"source": "A1 = (.25 - a) / 2"
	},
	{
		"id": "026-parse-colon-line-break",
		"name": "parse colon line break",
		"source": "S = 1: GOSUB 3"
	},
	{
		"id": "027-parse-colon-with-statement",
		"name": "parse colon with statement",
		"source": "FOR m = 1 TO 2: S = P: NEXT"
	},
	{
		"id": "028-parse-dot-operator",
		"name": "parse dot operator",
		"source": "DIM ident(): ident(3).property"
	},
	{
		"id": "029-respect-operator-precedence",
		"name": "respect operator precedence",
		"source": "Col - (LEN(Text$) / 2 + .5)"
	},
	{
		"id": "030-respect-addition-and-substraction-precedence",
		"name": "respect addition and substraction precedence",
		"source": "BottomLine + i - WHeight"
	},
	{
		"id": "031-respect-comparison-precedence",
		"name": "respect comparison precedence",
		"source": "(y# >= ScrHeight - 3)"
	},
	{
		"id": "032-respect-precedence",
		"name": "respect <> precedence",
		"source": "Impact OR LookX <> Scl(4)"
	},
	{
		"id": "033-respect-or-precedence",
		"name": "respect OR precedence",
		"source": "Num > 0 AND Num < 3 OR Num = 0"
	},
	{
		"id": "034-respect-not-precedence",
		"name": "respect NOT precedence",
		"source": "PRINT NOT ShotInSun AND NOT Impact"
	},
	{
		"id": "035-parse-groups-with-precedence",
		"name": "parse groups with precedence",
		"source": "(NOT Impact) AND OnScreen"
	},
	{
		"id": "036-parse-value",
		"name": "parse value",
		"source": "CONST TRUE = -1"
	},
	{
		"id": "037-parse-expression",
		"name": "parse expression",
		"source": "CONST FALSE = NOT TRUE"
	},
	{
		"id": "038-parse-def-seg",
		"name": "parse DEF SEG",
		"source": "DEF SEG = 0"
	},
	{
		"id": "039-parse-function-def",
		"name": "parse function def",
		"source": "DEF FnRan (x) = INT(1)"
	},
	{
		"id": "040-parse-range",
		"name": "parse range",
		"source": "DIM sx AS SINGLE"
	},
	{
		"id": "041-parse-property-access",
		"name": "parse property access",
		"source": "DO: DIM BCoor(): BCoor(CurBuilding).XCoor = 10: LOOP WHILE 0"
	},
	{
		"id": "042-parse-dim-comparison",
		"name": "parse dim comparison",
		"source": "DO: DIM SC(): IF SC(75) = 1 THEN x = 5\n LOOP WHILE 0"
	},
	{
		"id": "043-parse-range",
		"name": "parse range",
		"source": "DIM SHARED GorillaX(1 TO 2)"
	},
	{
		"id": "044-parse-dim-call",
		"name": "parse dim call",
		"source": "SUB test\nDIM SHARED flame(64, 40) AS INTEGER\nflame(2,3)\nEND SUB"
	},
	{
		"id": "045-parse-dim-assignment",
		"name": "parse dim assignment",
		"source": "SUB F\nDIM SHARED X(2,3)\nX(2,3)=10\nEND SUB"
	},
	{
		"id": "046-parse",
		"name": "parse",
		"source": "ON ERROR RESUME NEXT"
	},
	{
		"id": "047-parse-on-error-goto",
		"name": "parse ON ERROR GOTO",
		"source": "ON ERROR GOTO Error"
	},
	{
		"id": "048-parse-function-with-no-parameters",
		"name": "parse function with no parameters",
		"source": "SUB test\nEND SUB"
	},
	{
		"id": "049-parse-empty-function",
		"name": "parse empty function",
		"source": "SUB test(w$, x)\nEND SUB"
	},
	{
		"id": "050-parse-function-with-block",
		"name": "parse function with block",
		"source": "SUB test(w$, x)\nOUT &H3C8, 1\nEND SUB"
	},
	{
		"id": "051-parse-function-with-dim-parameters",
		"name": "parse function with dim parameters",
		"source": "SUB MakeCityScape (BCoor() AS XYPoint)\nEND SUB"
	},
	{
		"id": "052-add-symbols-to-scope",
		"name": "add symbols to scope",
		"source": "SUB MakeCityScape()\nDIM BCoor(0 TO 30) AS XYPoint\nCALL MakeCityScape(BCoor())\nEND SUB"
	},
	{
		"id": "053-parse-step",
		"name": "parse STEP",
		"source": "FOR y = 39 TO 0 STEP -1"
	},
	{
		"id": "054-parse-block",
		"name": "parse block",
		"source": "FOR b = 1 TO 63\nOUT 968, b\nNEXT b"
	},
	{
		"id": "055-parse-nested-next",
		"name": "parse nested next",
		"source": "FOR b=1 TO 6: FOR a=1 TO 3: NEXT a,b"
	},
	{
		"id": "056-parse-single-line",
		"name": "parse single line",
		"source": "IF true THEN x = 10"
	},
	{
		"id": "057-parse-single-line-in-sub",
		"name": "parse single line in sub",
		"source": "SUB sub1\n\t\t\t\tIF true THEN x\n\t\t\t\tEND SUB"
	},
	{
		"id": "058-parse-single-line-else",
		"name": "parse single line else",
		"source": "IF true THEN x = 10 ELSE PRINT \"10\""
	},
	{
		"id": "059-parse-block",
		"name": "parse block",
		"source": "IF true THEN\nx = 10\nEND IF"
	},
	{
		"id": "060-parse-if-with-comment",
		"name": "parse if with comment",
		"source": "IF true THEN 'Comment Node \nx = 10\nEND IF"
	},
	{
		"id": "061-parse-if-with-function-expression",
		"name": "parse if with function expression",
		"source": "IF POINT(x1, y1) = 1 THEN PRINT"
	},
	{
		"id": "062-parse-elseif",
		"name": "parse elseif",
		"source": "IF true THEN\nx = 10\nELSEIF false THEN y=20\nEND IF"
	},
	{
		"id": "063-parse-nested-if",
		"name": "parse nested IF",
		"source": "IF n! <> INT(n!) THEN\nIF Mode = 1 THEN n! = n! - 1\nEND IF"
	},
	{
		"id": "064-parse-single-line-colon-delimeter",
		"name": "parse single line colon delimeter",
		"source": "IF false THEN x = 10: y=20"
	},
	{
		"id": "065-parse-chain-single-line-if-else",
		"name": "parse chain single line IF ELSE",
		"source": "IF 1 THEN IF 2 THEN GOTO 4 ELSE GOTO 3 ELSE GOTO 2"
	},
	{
		"id": "066-parse",
		"name": "parse",
		"source": "\n$NoPrefix\nPrint Width / 2"
	},
	{
		"id": "067-parse-empty-until-loop",
		"name": "parse empty UNTIL loop",
		"source": "DO\nLOOP UNTIL x = 10"
	},
	{
		"id": "068-parse-until-loop-with-variable",
		"name": "parse UNTIL loop with variable",
		"source": "DO\nPRINT\nLOOP UNTIL f > 2400"
	},
	{
		"id": "069-parse-do-until",
		"name": "parse DO UNTIL",
		"source": "DO UNTIL atrib <= 0: LOOP"
	},
	{
		"id": "070-parse-statement",
		"name": "parse statement",
		"source": "LINE (110, 70)-(190, 120), , B"
	},
	{
		"id": "071-case",
		"name": "",
		"source": "LINE (x - Scl(22), y - Scl(18))-(x + Scl(22), y + Scl(18)), BACKATTR, BF"
	},
	{
		"id": "072-parse-statement",
		"name": "parse statement",
		"source": "REDIM Sprite%(240)"
	},
	{
		"id": "073-parse-statement",
		"name": "parse statement",
		"source": "PUT (x1%, y1%), Box%, XOR"
	},
	{
		"id": "074-parse-dim-parameters",
		"name": "parse dim parameters",
		"source": "DIM x1(), y1(): PUT (x1, y1), Box%, XOR"
	},
	{
		"id": "075-parse-case-is",
		"name": "parse CASE IS",
		"source": "SELECT CASE Total\nCASE IS >= 5\nEND SELECT"
	},
	{
		"id": "076-parse-case-to",
		"name": "parse CASE TO",
		"source": "SELECT CASE Total\nCASE 1 TO 2\nEND SELECT"
	},
	{
		"id": "077-parse-multiple-case-expressions",
		"name": "parse multiple CASE expressions",
		"source": "SELECT CASE kbd$:CASE \"w\", \"W\":x=2:END SELECT"
	},
	{
		"id": "078-parse-case-else",
		"name": "parse CASE ELSE",
		"source": "SELECT CASE A: CASE 10: B=10: CASE ELSE: B=1:END SELECT"
	},
	{
		"id": "079-parse-prompt",
		"name": "parse prompt",
		"source": "INPUT \"Enter: \", Total"
	},
	{
		"id": "080-parse-prompt",
		"name": "parse prompt",
		"source": "LINE INPUT \"Name\"; Player1$"
	},
	{
		"id": "081-parse-prompt",
		"name": "parse prompt",
		"source": "FUNCTION GetNum# (Row, Col)\nGetNum# = VAL(Result$)\nEND FUNCTION"
	},
	{
		"id": "082-declare-a-sub",
		"name": "declare a SUB",
		"source": "DECLARE SUB DoSun (Mouth)"
	},
	{
		"id": "083-declare-a-sub-with-dim-parameters",
		"name": "declare a SUB with DIM parameters",
		"source": "DECLARE SUB MakeCityScape (BCoor() AS ANY)"
	},
	{
		"id": "084-parse-function-values",
		"name": "parse function values",
		"source": "CIRCLE (x#, y#), c#, ExplosionColor"
	},
	{
		"id": "085-parse-function-values",
		"name": "parse function values",
		"source": "SUB test(x,y): END SUB: CALL test(10, 20)"
	},
	{
		"id": "086-parse-draw-string",
		"name": "parse draw string",
		"source": "123 DRAW\"BM14,18\""
	},
	{
		"id": "087-parse-assignment",
		"name": "parse assignment",
		"source": "x$ = INPUT$(0)"
	},
	{
		"id": "088-parse-timer",
		"name": "parse TIMER",
		"source": "RANDOMIZE TIMER MOD 32768"
	},
	{
		"id": "089-parse-numbers-and-text",
		"name": "parse numbers and text",
		"source": "DATA .5,o3b-fdo2a-,-25,p64"
	},
	{
		"id": "090-parse-eol",
		"name": "parse _ eol",
		"source": "Disabled =  _\n1.0"
	},
	{
		"id": "091-parse-eol-after-sub-call",
		"name": "parse EOL after SUB call",
		"source": "Intro\nGetInputs name1$, name2$\n"
	},
	{
		"id": "092-parse-empty-parameters",
		"name": "parse empty parameters",
		"source": "PRINT \"     Version:\", ,"
	},
	{
		"id": "093-parse-data-initialization",
		"name": "parse data initialization",
		"source": "\nSTATIC SHARED InternalFont(0 TO 318) AS SHORT => {-7937,_\r\n-8199,_\n-16480 }"
	}
] as const satisfies readonly CompatibilityCase[];

export const demoNames = [
	"acalc.bas",
	"bigflame.bas",
	"carols.bas",
	"castle.bas",
	"clock.bas",
	"colors.bas",
	"cuberot.bas",
	"donkey.bas",
	"flrmp.bas",
	"frac1.bas",
	"gorilla.bas",
	"gujero2.bas",
	"lissaj.bas",
	"nibbles.bas",
	"oregon-trail.bas",
	"qblocks.bas",
	"qbricks.bas",
	"qmaze.bas",
	"qships.bas",
	"qspace.bas",
	"qsynth.bas",
	"reversi.bas",
	"sortdemo.bas",
	"twirl2.bas"
] as const;
