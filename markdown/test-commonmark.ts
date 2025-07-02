export default [
	{
		md: '\tfoo\tbaz\t\tbim\n',
		html: '<pre><code>foo\tbaz\t\tbim\n</code></pre>\n',
		section: 'Tabs',
	},
	{
		md: '  \tfoo\tbaz\t\tbim\n',
		html: '<pre><code>foo\tbaz\t\tbim\n</code></pre>\n',
		section: 'Tabs',
	},
	{
		md: '    a\ta\n    ὐ\ta\n',
		html: '<pre><code>a\ta\nὐ\ta\n</code></pre>\n',
		section: 'Tabs',
	},
	{
		md: '  - foo\n\n\tbar\n',
		html: '<ul><li><p>foo</p><p>bar</p></li></ul>\n',
		section: 'Tabs',
	},
	{
		md: '- foo\n\n\t\tbar\n',
		html: '<ul><li><p>foo</p><pre><code>  bar\n</code></pre></li></ul>\n',
		section: 'Tabs',
	},
	{
		md: '>\t\tfoo\n',
		html: '<blockquote><pre><code>  foo\n</code></pre></blockquote>\n',
		section: 'Tabs',
	},
	{
		md: '-\t\tfoo\n',
		html: '<ul><li><pre><code>  foo\n</code></pre></li></ul>\n',
		section: 'Tabs',
	},
	{
		md: '    foo\n\tbar\n',
		html: '<pre><code>foo\nbar\n</code></pre>\n',
		section: 'Tabs',
	},
	{
		md: ' - foo\n   - bar\n\t - baz\n',
		html: '<ul><li>foo<ul><li>bar<ul><li>baz</li></ul></li></ul></li></ul>\n',
		section: 'Tabs',
	},
	{
		md: '#\tFoo\n',
		html: '<h1>Foo</h1>\n',
		section: 'Tabs',
	},
	{
		md: '*\t*\t*\t\n',
		html: '<hr />\n',
		section: 'Tabs',
	},
	{
		md: '\\!\\"\\#\\$\\%\\&\\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~\n',
		html: "<p>!&quot;#$%&amp;'()*+,-./:;&lt;=&gt;?@[\\]^_`{|}~</p>\n",
		section: 'Backslash escapes',
	},
	{
		md: '\\\t\\A\\a\\ \\3\\φ\\«\n',
		html: '<p>\\\t\\A\\a\\ \\3\\φ\\«</p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '\\*not emphasized*\n\\<br/> not a tag\n\\[not a link](/foo)\n\\`not code`\n1\\. not a list\n\\* not a list\n\\# not a heading\n\\[foo]: /url "not a reference"\n\\&ouml; not a character entity\n',
		html: '<p>*not emphasized*\n&lt;br/&gt; not a tag\n[not a link](/foo)\n`not code`\n1. not a list\n* not a list\n# not a heading\n[foo]: /url &quot;not a reference&quot;\n&amp;ouml; not a character entity</p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '\\\\*emphasis*\n',
		html: '<p>\\<em>emphasis</em></p>\n',
		section: 'Backslash escapes',
	},
	{
		md: 'foo\\\nbar\n',
		html: '<p>foo<br />\nbar</p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '`` \\[\\` ``\n',
		html: '<p><code>\\[\\`</code></p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '    \\[\\]\n',
		html: '<pre><code>\\[\\]\n</code></pre>\n',
		section: 'Backslash escapes',
	},
	{
		md: '~~~\n\\[\\]\n~~~\n',
		html: '<pre><code>\\[\\]\n</code></pre>\n',
		section: 'Backslash escapes',
	},
	{
		md: '<https://example.com?find=\\*>\n',
		html: '<p><a href="https://example.com?find=%5C*">https://example.com?find=\\*</a></p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '<a href="/bar\\/)">\n',
		html: '<a href="/bar\\/)">\n',
		section: 'Backslash escapes',
	},
	{
		md: '[foo](/bar\\* "ti\\*tle")\n',
		html: '<p><a href="/bar*" title="ti*tle">foo</a></p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '[foo]\n\n[foo]: /bar\\* "ti\\*tle"\n',
		html: '<p><a href="/bar*" title="ti*tle">foo</a></p>\n',
		section: 'Backslash escapes',
	},
	{
		md: '``` foo\\+bar\nfoo\n```\n',
		html: '<pre><code class="language-foo+bar">foo\n</code></pre>\n',
		section: 'Backslash escapes',
	},
	{
		md: '&nbsp; &amp; &copy; &AElig; &Dcaron;\n&frac34; &HilbertSpace; &DifferentialD;\n&ClockwiseContourIntegral; &ngE;\n',
		html: '<p>  &amp; © Æ Ď\n¾ ℋ ⅆ\n∲ ≧̸</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&#35; &#1234; &#992; &#0;\n',
		html: '<p># Ӓ Ϡ �</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&#X22; &#XD06; &#xcab;\n',
		html: '<p>&quot; ആ ಫ</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&nbsp &x; &#; &#x;\n&#87654321;\n&#abcdef0;\n&ThisIsNotDefined; &hi?;\n',
		html: '<p>&amp;nbsp &amp;x; &amp;#; &amp;#x;\n&amp;#87654321;\n&amp;#abcdef0;\n&amp;ThisIsNotDefined; &amp;hi?;</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&copy\n',
		html: '<p>&amp;copy</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&MadeUpEntity;\n',
		html: '<p>&amp;MadeUpEntity;</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '<a href="&ouml;&ouml;.html">\n',
		html: '<a href="&ouml;&ouml;.html">\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '[foo](/f&ouml;&ouml; "f&ouml;&ouml;")\n',
		html: '<p><a href="/f%C3%B6%C3%B6" title="föö">foo</a></p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '[foo]\n\n[foo]: /f&ouml;&ouml; "f&ouml;&ouml;"\n',
		html: '<p><a href="/f%C3%B6%C3%B6" title="föö">foo</a></p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '``` f&ouml;&ouml;\nfoo\n```\n',
		html: '<pre><code class="language-föö">foo\n</code></pre>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '`f&ouml;&ouml;`\n',
		html: '<p><code>f&amp;ouml;&amp;ouml;</code></p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '    f&ouml;f&ouml;\n',
		html: '<pre><code>f&amp;ouml;f&amp;ouml;\n</code></pre>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&#42;foo&#42;\n*foo*\n',
		html: '<p>*foo*\n<em>foo</em></p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&#42; foo\n\n* foo\n',
		html: '<p>* foo</p>\n<ul>\n<li>foo</li>\n</ul>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: 'foo&#10;&#10;bar\n',
		html: '<p>foo\n\nbar</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '&#9;foo\n',
		html: '<p>\tfoo</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '[a](url &quot;tit&quot;)\n',
		html: '<p>[a](url &quot;tit&quot;)</p>\n',
		section: 'Entity and numeric character references',
	},
	{
		md: '- `one\n- two`\n',
		html: '<ul><li>`one</li><li>two`</li></ul>\n',
		section: 'Precedence',
	},
	{
		md: '***\n---\n___\n',
		html: '<hr /><hr /><hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: '+++\n',
		html: '<p>+++</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: '===\n',
		html: '<p>===</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: '--\n**\n__\n',
		html: '<p>--\n**\n__</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: ' ***\n  ***\n   ***\n',
		html: '<hr /><hr /><hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: '    ***\n',
		html: '<pre><code>***\n</code></pre>\n',
		section: 'Thematic breaks',
	},
	{
		md: 'Foo\n    ***\n',
		html: '<p>Foo\n***</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: '_____________________________________\n',
		html: '<hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: ' - - -\n',
		html: '<hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: ' **  * ** * ** * **\n',
		html: '<hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: '-     -      -      -\n',
		html: '<hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: '- - - -    \n',
		html: '<hr />\n',
		section: 'Thematic breaks',
	},
	{
		md: '_ _ _ _ a\n\na------\n\n---a---\n',
		html: '<p>_ _ _ _ a</p><p>a------</p><p>---a---</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: ' *-*\n',
		html: '<p><em>-</em></p>\n',
		section: 'Thematic breaks',
	},
	{
		md: '- foo\n***\n- bar\n',
		html: '<ul><li>foo</li></ul><hr /><ul><li>bar</li></ul>\n',
		section: 'Thematic breaks',
	},
	{
		md: 'Foo\n***\nbar\n',
		html: '<p>Foo</p><hr /><p>bar</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: 'Foo\n---\nbar\n',
		html: '<h2>Foo</h2><p>bar</p>\n',
		section: 'Thematic breaks',
	},
	{
		md: '* Foo\n* * *\n* Bar\n',
		html: '<ul><li>Foo</li></ul><hr /><ul><li>Bar</li></ul>\n',
		section: 'Thematic breaks',
	},
	{
		md: '- Foo\n- * * *\n',
		html: '<ul><li>Foo</li><li><hr /></li></ul>\n',
		section: 'Thematic breaks',
	},
	{
		md: '# foo\n## foo\n### foo\n#### foo\n##### foo\n###### foo\n',
		html: '<h1>foo</h1><h2>foo</h2><h3>foo</h3><h4>foo</h4><h5>foo</h5><h6>foo</h6>\n',
		section: 'ATX headings',
	},
	{
		md: '####### foo\n',
		html: '<p>####### foo</p>\n',
		section: 'ATX headings',
	},
	{
		md: '#5 bolt\n\n#hashtag\n',
		html: '<p>#5 bolt</p><p>#hashtag</p>\n',
		section: 'ATX headings',
	},
	{
		md: '\\## foo\n',
		html: '<p>## foo</p>\n',
		section: 'ATX headings',
	},
	{
		md: '# foo *bar* \\*baz\\*\n',
		html: '<h1>foo <em>bar</em> *baz*</h1>\n',
		section: 'ATX headings',
	},
	{
		md: '#                  foo                     \n',
		html: '<h1>foo</h1>\n',
		section: 'ATX headings',
	},
	{
		md: ' ### foo\n  ## foo\n   # foo\n',
		html: '<h3>foo</h3><h2>foo</h2><h1>foo</h1>\n',
		section: 'ATX headings',
	},
	{
		md: '    # foo\n',
		html: '<pre><code># foo\n</code></pre>\n',
		section: 'ATX headings',
	},
	{
		md: 'foo\n    # bar\n',
		html: '<p>foo\n# bar</p>\n',
		section: 'ATX headings',
	},
	{
		md: '## foo ##\n  ###   bar    ###\n',
		html: '<h2>foo</h2><h3>bar</h3>\n',
		section: 'ATX headings',
	},
	{
		md: '# foo ##################################\n##### foo ##\n',
		html: '<h1>foo</h1><h5>foo</h5>\n',
		section: 'ATX headings',
	},
	{
		md: '### foo ###     \n',
		html: '<h3>foo</h3>\n',
		section: 'ATX headings',
	},
	{
		md: '### foo ### b\n',
		html: '<h3>foo ### b</h3>\n',
		section: 'ATX headings',
	},
	{
		md: '# foo#\n',
		html: '<h1>foo#</h1>\n',
		section: 'ATX headings',
	},
	{
		md: '### foo \\###\n## foo #\\##\n# foo \\#\n',
		html: '<h3>foo ###</h3><h2>foo ###</h2><h1>foo #</h1>\n',
		section: 'ATX headings',
	},
	{
		md: '****\n## foo\n****\n',
		html: '<hr /><h2>foo</h2><hr />\n',
		section: 'ATX headings',
	},
	{
		md: 'Foo bar\n# baz\nBar foo\n',
		html: '<p>Foo bar</p><h1>baz</h1><p>Bar foo</p>\n',
		section: 'ATX headings',
	},
	{
		md: '## \n#\n### ###\n',
		html: '<h2></h2><h1></h1><h3></h3>\n',
		section: 'ATX headings',
	},
	{
		md: 'Foo *bar*\n=========\n\nFoo *bar*\n---------\n',
		html: '<h1>Foo <em>bar</em></h1><h2>Foo <em>bar</em></h2>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo *bar\nbaz*\n====\n',
		html: '<h1>Foo <em>bar\nbaz</em></h1>\n',
		section: 'Setext headings',
	},
	{
		md: '  Foo *bar\nbaz*\t\n====\n',
		html: '<h1>Foo <em>bar\nbaz</em></h1>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\n-------------------------\n\nFoo\n=\n',
		html: '<h2>Foo</h2><h1>Foo</h1>\n',
		section: 'Setext headings',
	},
	{
		md: '   Foo\n---\n\n  Foo\n-----\n\n  Foo\n  ===\n',
		html: '<h2>Foo</h2><h2>Foo</h2><h1>Foo</h1>\n',
		section: 'Setext headings',
	},
	{
		md: '    Foo\n    ---\n\n    Foo\n---\n',
		html: '<pre><code>Foo\n---\n\nFoo\n</code></pre><hr />\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\n   ----      \n',
		html: '<h2>Foo</h2>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\n    ---\n',
		html: '<p>Foo\n---</p>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\n= =\n\nFoo\n--- -\n',
		html: '<p>Foo\n= =</p><p>Foo</p><hr />\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo  \n-----\n',
		html: '<h2>Foo</h2>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\\\n----\n',
		html: '<h2>Foo\\</h2>\n',
		section: 'Setext headings',
	},
	{
		md: '`Foo\n----\n`\n\n<a title="a lot\n---\nof dashes"/>\n',
		html: '<h2>`Foo</h2><p>`</p><h2>&lt;a title=&quot;a lot</h2><p>of dashes&quot;/&gt;</p>\n',
		section: 'Setext headings',
	},
	{
		md: '> Foo\n---\n',
		html: '<blockquote><p>Foo</p></blockquote><hr />\n',
		section: 'Setext headings',
	},
	{
		md: '> foo\nbar\n===\n',
		html: '<blockquote><p>foo\nbar\n===</p></blockquote>\n',
		section: 'Setext headings',
	},
	{
		md: '- Foo\n---\n',
		html: '<ul><li>Foo</li></ul><hr />\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\nBar\n---\n',
		html: '<h2>Foo\nBar</h2>\n',
		section: 'Setext headings',
	},
	{
		md: '---\nFoo\n---\nBar\n---\nBaz\n',
		html: '<hr /><h2>Foo</h2><h2>Bar</h2><p>Baz</p>\n',
		section: 'Setext headings',
	},
	{
		md: '\n====\n',
		html: '<p>====</p>\n',
		section: 'Setext headings',
	},
	{
		md: '---\n---\n',
		html: '<hr /><hr />\n',
		section: 'Setext headings',
	},
	{
		md: '- foo\n-----\n',
		html: '<ul><li>foo</li></ul><hr />\n',
		section: 'Setext headings',
	},
	{
		md: '    foo\n---\n',
		html: '<pre><code>foo\n</code></pre><hr />\n',
		section: 'Setext headings',
	},
	{
		md: '> foo\n-----\n',
		html: '<blockquote><p>foo</p></blockquote><hr />\n',
		section: 'Setext headings',
	},
	{
		md: '\\> foo\n------\n',
		html: '<h2>&gt; foo</h2>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\n\nbar\n---\nbaz\n',
		html: '<p>Foo</p><h2>bar</h2><p>baz</p>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\nbar\n\n---\n\nbaz\n',
		html: '<p>Foo\nbar</p><hr /><p>baz</p>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\nbar\n* * *\nbaz\n',
		html: '<p>Foo\nbar</p><hr /><p>baz</p>\n',
		section: 'Setext headings',
	},
	{
		md: 'Foo\nbar\n\\---\nbaz\n',
		html: '<p>Foo\nbar\n---\nbaz</p>\n',
		section: 'Setext headings',
	},
	{
		md: '    a simple\n      indented code block\n',
		html: '<pre><code>a simple\n  indented code block\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '  - foo\n\n    bar\n',
		html: '<ul><li><p>foo</p><p>bar</p></li></ul>\n',
		section: 'Indented code blocks',
	},
	{
		md: '1.  foo\n\n    - bar\n',
		html: '<ol><li><p>foo</p><ul><li>bar</li></ul></li></ol>\n',
		section: 'Indented code blocks',
	},
	{
		md: '    <a/>\n    *hi*\n\n    - one\n',
		html: '<pre><code>&lt;a/&gt;\n*hi*\n\n- one\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '    chunk1\n\n    chunk2\n  \n \n \n    chunk3\n',
		html: '<pre><code>chunk1\n\nchunk2\n\n\n\nchunk3\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '    chunk1\n      \n      chunk2\n',
		html: '<pre><code>chunk1\n  \n  chunk2\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: 'Foo\n    bar\n\n',
		html: '<p>Foo\nbar</p>\n',
		section: 'Indented code blocks',
	},
	{
		md: '    foo\nbar\n',
		html: '<pre><code>foo\n</code></pre><p>bar</p>\n',
		section: 'Indented code blocks',
	},
	{
		md: '# Heading\n    foo\nHeading\n------\n    foo\n----\n',
		html: '<h1>Heading</h1><pre><code>foo\n</code></pre><h2>Heading</h2><pre><code>foo\n</code></pre><hr />\n',
		section: 'Indented code blocks',
	},
	{
		md: '        foo\n    bar\n',
		html: '<pre><code>    foo\nbar\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '\n    \n    foo\n    \n\n',
		html: '<pre><code>foo\n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '    foo  \n',
		html: '<pre><code>foo  \n</code></pre>\n',
		section: 'Indented code blocks',
	},
	{
		md: '```\n<\n >\n```\n',
		html: '<pre><code>&lt;\n &gt;\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~\n<\n >\n~~~\n',
		html: '<pre><code>&lt;\n &gt;\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '``\nfoo\n``\n',
		html: '<p><code>foo</code></p>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\naaa\n~~~\n```\n',
		html: '<pre><code>aaa\n~~~\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~\naaa\n```\n~~~\n',
		html: '<pre><code>aaa\n```\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '````\naaa\n```\n``````\n',
		html: '<pre><code>aaa\n```\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~~\naaa\n~~~\n~~~~\n',
		html: '<pre><code>aaa\n~~~\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\n',
		html: '<pre><code></code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '`````\n\n```\naaa\n',
		html: '<pre><code>\n```\naaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '> ```\n> aaa\n\nbbb\n',
		html: '<blockquote><pre><code>aaa\n</code></pre></blockquote><p>bbb</p>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\n\n  \n```\n',
		html: '<pre><code>\n  \n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\n```\n',
		html: '<pre><code></code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: ' ```\n aaa\naaa\n```\n',
		html: '<pre><code>aaa\naaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '  ```\naaa\n  aaa\naaa\n  ```\n',
		html: '<pre><code>aaa\naaa\naaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '   ```\n   aaa\n    aaa\n  aaa\n   ```\n',
		html: '<pre><code>aaa\n aaa\naaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '    ```\n    aaa\n    ```\n',
		html: '<pre><code>```\naaa\n```\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\naaa\n  ```\n',
		html: '<pre><code>aaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '   ```\naaa\n  ```\n',
		html: '<pre><code>aaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\naaa\n    ```\n',
		html: '<pre><code>aaa\n    ```\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '``` ```\naaa\n',
		html: '<p><code> </code>\naaa</p>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~~~~\naaa\n~~~ ~~\n',
		html: '<pre><code>aaa\n~~~ ~~\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: 'foo\n```\nbar\n```\nbaz\n',
		html: '<p>foo</p><pre><code>bar\n</code></pre><p>baz</p>\n',
		section: 'Fenced code blocks',
	},
	{
		md: 'foo\n---\n~~~\nbar\n~~~\n# baz\n',
		html: '<h2>foo</h2><pre><code>bar\n</code></pre><h1>baz</h1>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```ruby\ndef foo(x)\n  return 3\nend\n```\n',
		html: '<pre><code class="language-ruby">def foo(x)\n  return 3\nend\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~~    ruby startline=3 $%@#$\ndef foo(x)\n  return 3\nend\n~~~~~~~\n',
		html: '<pre><code class="language-ruby">def foo(x)\n  return 3\nend\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '````;\n````\n',
		html: '<pre><code class="language-;"></code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '``` aa ```\nfoo\n',
		html: '<p><code>aa</code>\nfoo</p>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '~~~ aa ``` ~~~\nfoo\n~~~\n',
		html: '<pre><code class="language-aa">foo\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '```\n``` aaa\n```\n',
		html: '<pre><code>``` aaa\n</code></pre>\n',
		section: 'Fenced code blocks',
	},
	{
		md: '<table><tr><td>\n<pre>\n**Hello**,\n\n_world_.\n</pre>\n</td></tr></table>\n',
		html: '<table><tr><td>\n<pre>\n**Hello**,\n<p><em>world</em>.\n</pre></p></td></tr></table>\n',
		section: 'HTML blocks',
	},
	{
		md: '<table>\n  <tr>\n    <td>\n           hi\n    </td>\n  </tr>\n</table>\n\nokay.\n',
		html: '<table>\n  <tr>\n    <td>\n           hi\n    </td>\n  </tr>\n</table>\n<p>okay.</p>\n',
		section: 'HTML blocks',
	},
	{
		md: ' <div>\n  *hello*\n         <foo><a>\n',
		html: ' <div>\n  *hello*\n         <foo><a>\n',
		section: 'HTML blocks',
	},
	{
		md: '</div>\n*foo*\n',
		html: '</div>\n*foo*\n',
		section: 'HTML blocks',
	},
	{
		md: '<DIV CLASS="foo">\n\n*Markdown*\n\n</DIV>\n',
		html: '<DIV CLASS="foo">\n<p><em>Markdown</em></p></DIV>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div id="foo"\n  class="bar">\n</div>\n',
		html: '<div id="foo"\n  class="bar">\n</div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div id="foo" class="bar\n  baz">\n</div>\n',
		html: '<div id="foo" class="bar\n  baz">\n</div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div>\n*foo*\n\n*bar*\n',
		html: '<div>\n*foo*\n<p><em>bar</em></p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div id="foo"\n*hi*\n',
		html: '<div id="foo"\n*hi*\n',
		section: 'HTML blocks',
	},
	{
		md: '<div class\nfoo\n',
		html: '<div class\nfoo\n',
		section: 'HTML blocks',
	},
	{
		md: '<div *???-&&&-<---\n*foo*\n',
		html: '<div *???-&&&-<---\n*foo*\n',
		section: 'HTML blocks',
	},
	{
		md: '<div><a href="bar">*foo*</a></div>\n',
		html: '<div><a href="bar">*foo*</a></div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<table><tr><td>\nfoo\n</td></tr></table>\n',
		html: '<table><tr><td>\nfoo\n</td></tr></table>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div></div>\n``` c\nint x = 33;\n```\n',
		html: '<div></div>\n``` c\nint x = 33;\n```\n',
		section: 'HTML blocks',
	},
	{
		md: '<a href="foo">\n*bar*\n</a>\n',
		html: '<a href="foo">\n*bar*\n</a>\n',
		section: 'HTML blocks',
	},
	{
		md: '<Warning>\n*bar*\n</Warning>\n',
		html: '<Warning>\n*bar*\n</Warning>\n',
		section: 'HTML blocks',
	},
	{
		md: '<i class="foo">\n*bar*\n</i>\n',
		html: '<i class="foo">\n*bar*\n</i>\n',
		section: 'HTML blocks',
	},
	{
		md: '</ins>\n*bar*\n',
		html: '</ins>\n*bar*\n',
		section: 'HTML blocks',
	},
	{
		md: '<del>\n*foo*\n</del>\n',
		html: '<del>\n*foo*\n</del>\n',
		section: 'HTML blocks',
	},
	{
		md: '<del>\n\n*foo*\n\n</del>\n',
		html: '<del>\n<p><em>foo</em></p></del>\n',
		section: 'HTML blocks',
	},
	{
		md: '<del>*foo*</del>\n',
		html: '<p><del><em>foo</em></del></p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<pre language="haskell"><code>\nimport Text.HTML.TagSoup\n\nmain :: IO ()\nmain = print $ parseTags tags\n</code></pre>\nokay\n',
		html: '<pre language="haskell"><code>\nimport Text.HTML.TagSoup\n\nmain :: IO ()\nmain = print $ parseTags tags\n</code></pre>\n<p>okay</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<script type="text/javascript">\n// JavaScript example\n\ndocument.getElementById("demo").innerHTML = "Hello JavaScript!";\n</script>\nokay\n',
		html: '<script type="text/javascript">\n// JavaScript example\n\ndocument.getElementById("demo").innerHTML = "Hello JavaScript!";\n</script>\n<p>okay</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<textarea>\n\n*foo*\n\n_bar_\n\n</textarea>\n',
		html: '<textarea>\n\n*foo*\n\n_bar_\n\n</textarea>\n',
		section: 'HTML blocks',
	},
	{
		md: '<style\n  type="text/css">\nh1 {color:red;}\n\np {color:blue;}\n</style>\nokay\n',
		html: '<style\n  type="text/css">\nh1 {color:red;}\n\np {color:blue;}\n</style>\n<p>okay</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<style\n  type="text/css">\n\nfoo\n',
		html: '<style\n  type="text/css">\n\nfoo\n',
		section: 'HTML blocks',
	},
	{
		md: '> <div>\n> foo\n\nbar\n',
		html: '<blockquote><div>\nfoo\n</blockquote><p>bar</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '- <div>\n- foo\n',
		html: '<ul><li><div></li><li>foo</li></ul>\n',
		section: 'HTML blocks',
	},
	{
		md: '<style>p{color:red;}</style>\n*foo*\n',
		html: '<style>p{color:red;}</style>\n<p><em>foo</em></p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<!-- foo -->*bar*\n*baz*\n',
		html: '<!-- foo -->*bar*\n<p><em>baz</em></p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<script>\nfoo\n</script>1. *bar*\n',
		html: '<script>\nfoo\n</script>1. *bar*\n',
		section: 'HTML blocks',
	},
	{
		md: '<!-- Foo\n\nbar\n   baz -->\nokay\n',
		html: '<!-- Foo\n\nbar\n   baz -->\n<p>okay</p>\n',
		section: 'HTML blocks',
	},
	{
		md: "<?php\n\n  echo '>';\n\n?>\nokay\n",
		html: "<?php\n\n  echo '>';\n\n?>\n<p>okay</p>\n",
		section: 'HTML blocks',
	},
	{
		md: '<!DOCTYPE html>\n',
		html: '<!DOCTYPE html>\n',
		section: 'HTML blocks',
	},
	{
		md: '<![CDATA[\nfunction matchwo(a,b)\n{\n  if (a < b && a < 0) then {\n    return 1;\n\n  } else {\n\n    return 0;\n  }\n}\n]]>\nokay\n',
		html: '<![CDATA[\nfunction matchwo(a,b)\n{\n  if (a < b && a < 0) then {\n    return 1;\n\n  } else {\n\n    return 0;\n  }\n}\n]]>\n<p>okay</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '  <!-- foo -->\n\n    <!-- foo -->\n',
		html: '  <!-- foo -->\n<pre><code>&lt;!-- foo --&gt;\n</code></pre>\n',
		section: 'HTML blocks',
	},
	{
		md: '  <div>\n\n    <div>\n',
		html: '  <div>\n<pre><code>&lt;div&gt;\n</code></pre>\n',
		section: 'HTML blocks',
	},
	{
		md: 'Foo\n<div>\nbar\n</div>\n',
		html: '<p>Foo</p><div>\nbar\n</div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div>\nbar\n</div>\n*foo*\n',
		html: '<div>\nbar\n</div>\n*foo*\n',
		section: 'HTML blocks',
	},
	{
		md: 'Foo\n<a href="bar">\nbaz\n',
		html: '<p>Foo\n<a href="bar">\nbaz</p>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div>\n\n*Emphasized* text.\n\n</div>\n',
		html: '<div>\n<p><em>Emphasized</em> text.</p></div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<div>\n*Emphasized* text.\n</div>\n',
		html: '<div>\n*Emphasized* text.\n</div>\n',
		section: 'HTML blocks',
	},
	{
		md: '<table>\n\n<tr>\n\n<td>\nHi\n</td>\n\n</tr>\n\n</table>\n',
		html: '<table>\n<tr>\n<td>\nHi\n</td>\n</tr>\n</table>\n',
		section: 'HTML blocks',
	},
	{
		md: '<table>\n\n  <tr>\n\n    <td>\n      Hi\n    </td>\n\n  </tr>\n\n</table>\n',
		html: '<table>\n  <tr>\n<pre><code>&lt;td&gt;\n  Hi\n&lt;/td&gt;\n</code></pre>  </tr>\n</table>\n',
		section: 'HTML blocks',
	},
	{
		md: '[foo]: /url "title"\n\n[foo]\n',
		html: '<p><a href="/url" title="title">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: "   [foo]: \n      /url  \n           'the title'  \n\n[foo]\n",
		html: '<p><a href="/url" title="the title">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: "[Foo*bar\\]]:my_(url) 'title (with parens)'\n\n[Foo*bar\\]]\n",
		html: '<p><a href="my_(url)" title="title (with parens)">Foo*bar]</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: "[Foo bar]:\n<my url>\n'title'\n\n[Foo bar]\n",
		html: '<p><a href="my%20url" title="title">Foo bar</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: "[foo]: /url '\ntitle\nline1\nline2\n'\n\n[foo]\n",
		html: '<p><a href="/url" title="\ntitle\nline1\nline2\n">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: "[foo]: /url 'title\n\nwith blank line'\n\n[foo]\n",
		html: "<p>[foo]: /url 'title</p><p>with blank line'</p><p>[foo]</p>\n",
		section: 'Link reference definitions',
	},
	{
		md: '[foo]:\n/url\n\n[foo]\n',
		html: '<p><a href="/url">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]:\n\n[foo]\n',
		html: '<p>[foo]:</p><p>[foo]</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: <>\n\n[foo]\n',
		html: '<p><a href="">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: <bar>(baz)\n\n[foo]\n',
		html: '<p>[foo]: <bar>(baz)</p><p>[foo]</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url\\bar\\*baz "foo\\"bar\\baz"\n\n[foo]\n',
		html: '<p><a href="/url%5Cbar*baz" title="foo&quot;bar\\baz">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]\n\n[foo]: url\n',
		html: '<p><a href="url">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]\n\n[foo]: first\n[foo]: second\n',
		html: '<p><a href="first">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[FOO]: /url\n\n[Foo]\n',
		html: '<p><a href="/url">Foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[ΑΓΩ]: /φου\n\n[αγω]\n',
		html: '<p><a href="/%CF%86%CE%BF%CF%85">αγω</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url\n',
		html: '',
		section: 'Link reference definitions',
	},
	{
		md: '[\nfoo\n]: /url\nbar\n',
		html: '<p>bar</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url "title" ok\n',
		html: '<p>[foo]: /url &quot;title&quot; ok</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url\n"title" ok\n',
		html: '<p>&quot;title&quot; ok</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '    [foo]: /url "title"\n\n[foo]\n',
		html: '<pre><code>[foo]: /url &quot;title&quot;\n</code></pre><p>[foo]</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '```\n[foo]: /url\n```\n\n[foo]\n',
		html: '<pre><code>[foo]: /url\n</code></pre><p>[foo]</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: 'Foo\n[bar]: /baz\n\n[bar]\n',
		html: '<p>Foo\n[bar]: /baz</p><p>[bar]</p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '# [Foo]\n[foo]: /url\n> bar\n',
		html: '<h1><a href="/url">Foo</a></h1><blockquote><p>bar</p></blockquote>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url\nbar\n===\n[foo]\n',
		html: '<h1>bar</h1><p><a href="/url">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /url\n===\n[foo]\n',
		html: '<p>===\n<a href="/url">foo</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]: /foo-url "foo"\n[bar]: /bar-url\n  "bar"\n[baz]: /baz-url\n\n[foo],\n[bar],\n[baz]\n',
		html: '<p><a href="/foo-url" title="foo">foo</a>,\n<a href="/bar-url" title="bar">bar</a>,\n<a href="/baz-url">baz</a></p>\n',
		section: 'Link reference definitions',
	},
	{
		md: '[foo]\n\n> [foo]: /url\n',
		html: '<p><a href="/url">foo</a></p><blockquote>\n</blockquote>\n',
		section: 'Link reference definitions',
	},
	{
		md: 'aaa\n\nbbb\n',
		html: '<p>aaa</p><p>bbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: 'aaa\nbbb\n\nccc\nddd\n',
		html: '<p>aaa\nbbb</p><p>ccc\nddd</p>\n',
		section: 'Paragraphs',
	},
	{
		md: 'aaa\n\n\nbbb\n',
		html: '<p>aaa</p><p>bbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: '  aaa\n bbb\n',
		html: '<p>aaa\nbbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: 'aaa\n             bbb\n                                       ccc\n',
		html: '<p>aaa\nbbb\nccc</p>\n',
		section: 'Paragraphs',
	},
	{
		md: '   aaa\nbbb\n',
		html: '<p>aaa\nbbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: '    aaa\nbbb\n',
		html: '<pre><code>aaa\n</code></pre><p>bbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: 'aaa     \nbbb     \n',
		html: '<p>aaa<br />\nbbb</p>\n',
		section: 'Paragraphs',
	},
	{
		md: '  \n\naaa\n  \n\n# aaa\n\n  \n',
		html: '<p>aaa</p><h1>aaa</h1>\n',
		section: 'Blank lines',
	},
	{
		md: '> # Foo\n> bar\n> baz\n',
		html: '<blockquote><h1>Foo</h1><p>bar\nbaz</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '># Foo\n>bar\n> baz\n',
		html: '<blockquote><h1>Foo</h1><p>bar\nbaz</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '   > # Foo\n   > bar\n > baz\n',
		html: '<blockquote><h1>Foo</h1><p>bar\nbaz</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '    > # Foo\n    > bar\n    > baz\n',
		html: '<pre><code>&gt; # Foo\n&gt; bar\n&gt; baz\n</code></pre>\n',
		section: 'Block quotes',
	},
	{
		md: '> # Foo\n> bar\nbaz\n',
		html: '<blockquote><h1>Foo</h1><p>bar\nbaz</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> bar\nbaz\n> foo\n',
		html: '<blockquote><p>bar\nbaz\nfoo</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> foo\n---\n',
		html: '<blockquote><p>foo</p></blockquote><hr />\n',
		section: 'Block quotes',
	},
	{
		md: '> - foo\n- bar\n',
		html: '<blockquote><ul><li>foo</li></ul></blockquote><ul><li>bar</li></ul>\n',
		section: 'Block quotes',
	},
	{
		md: '>     foo\n    bar\n',
		html: '<blockquote><pre><code>foo\n</code></pre></blockquote><pre><code>bar\n</code></pre>\n',
		section: 'Block quotes',
	},
	{
		md: '> ```\nfoo\n```\n',
		html: '<blockquote><pre><code></code></pre></blockquote><p>foo</p><pre><code></code></pre>\n',
		section: 'Block quotes',
	},
	{
		md: '> foo\n    - bar\n',
		html: '<blockquote><p>foo\n- bar</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '>\n',
		html: '<blockquote>\n</blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '>\n>  \n> \n',
		html: '<blockquote>\n</blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '>\n> foo\n>  \n',
		html: '<blockquote><p>foo</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> foo\n\n> bar\n',
		html: '<blockquote><p>foo</p></blockquote><blockquote><p>bar</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> foo\n> bar\n',
		html: '<blockquote><p>foo\nbar</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> foo\n>\n> bar\n',
		html: '<blockquote><p>foo</p><p>bar</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: 'foo\n> bar\n',
		html: '<p>foo</p><blockquote><p>bar</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> aaa\n***\n> bbb\n',
		html: '<blockquote><p>aaa</p></blockquote><hr /><blockquote><p>bbb</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> bar\nbaz\n',
		html: '<blockquote><p>bar\nbaz</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '> bar\n\nbaz\n',
		html: '<blockquote><p>bar</p></blockquote><p>baz</p>\n',
		section: 'Block quotes',
	},
	{
		md: '> bar\n>\nbaz\n',
		html: '<blockquote><p>bar</p></blockquote><p>baz</p>\n',
		section: 'Block quotes',
	},
	{
		md: '> > > foo\nbar\n',
		html: '<blockquote><blockquote><blockquote><p>foo\nbar</p></blockquote></blockquote></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '>>> foo\n> bar\n>>baz\n',
		html: '<blockquote><blockquote><blockquote><p>foo\nbar\nbaz</p></blockquote></blockquote></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: '>     code\n\n>    not code\n',
		html: '<blockquote><pre><code>code\n</code></pre></blockquote><blockquote><p>not code</p></blockquote>\n',
		section: 'Block quotes',
	},
	{
		md: 'A paragraph\nwith two lines.\n\n    indented code\n\n> A block quote.\n',
		html: '<p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote>\n',
		section: 'List items',
	},
	{
		md: '1.  A paragraph\n    with two lines.\n\n        indented code\n\n    > A block quote.\n',
		html: '<ol><li><p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '- one\n\n two\n',
		html: '<ul><li>one</li></ul><p>two</p>\n',
		section: 'List items',
	},
	{
		md: '- one\n\n  two\n',
		html: '<ul><li><p>one</p><p>two</p></li></ul>\n',
		section: 'List items',
	},
	{
		md: ' -    one\n\n     two\n',
		html: '<ul><li>one</li></ul><pre><code> two\n</code></pre>\n',
		section: 'List items',
	},
	{
		md: ' -    one\n\n      two\n',
		html: '<ul><li><p>one</p><p>two</p></li></ul>\n',
		section: 'List items',
	},
	{
		md: '   > > 1.  one\n>>\n>>     two\n',
		html: '<blockquote><blockquote><ol><li><p>one</p><p>two</p></li></ol></blockquote></blockquote>\n',
		section: 'List items',
	},
	{
		md: '>>- one\n>>\n  >  > two\n',
		html: '<blockquote><blockquote><ul><li>one</li></ul><p>two</p></blockquote></blockquote>\n',
		section: 'List items',
	},
	{
		md: '-one\n\n2.two\n',
		html: '<p>-one</p><p>2.two</p>\n',
		section: 'List items',
	},
	{
		md: '- foo\n\n\n  bar\n',
		html: '<ul><li><p>foo</p><p>bar</p></li></ul>\n',
		section: 'List items',
	},
	{
		md: '1.  foo\n\n    ```\n    bar\n    ```\n\n    baz\n\n    > bam\n',
		html: '<ol><li><p>foo</p><pre><code>bar\n</code></pre><p>baz</p><blockquote><p>bam</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '- Foo\n\n      bar\n\n\n      baz\n',
		html: '<ul><li><p>Foo</p><pre><code>bar\n\n\nbaz\n</code></pre></li></ul>\n',
		section: 'List items',
	},
	{
		md: '123456789. ok\n',
		html: '<ol start="123456789"><li>ok</li></ol>\n',
		section: 'List items',
	},
	{
		md: '1234567890. not ok\n',
		html: '<p>1234567890. not ok</p>\n',
		section: 'List items',
	},
	{
		md: '0. ok\n',
		html: '<ol start="0"><li>ok</li></ol>\n',
		section: 'List items',
	},
	{
		md: '003. ok\n',
		html: '<ol start="3"><li>ok</li></ol>\n',
		section: 'List items',
	},
	{
		md: '-1. not ok\n',
		html: '<p>-1. not ok</p>\n',
		section: 'List items',
	},
	{
		md: '- foo\n\n      bar\n',
		html: '<ul><li><p>foo</p><pre><code>bar\n</code></pre></li></ul>\n',
		section: 'List items',
	},
	{
		md: '  10.  foo\n\n           bar\n',
		html: '<ol start="10"><li><p>foo</p><pre><code>bar\n</code></pre></li></ol>\n',
		section: 'List items',
	},
	{
		md: '    indented code\n\nparagraph\n\n    more code\n',
		html: '<pre><code>indented code\n</code></pre><p>paragraph</p><pre><code>more code\n</code></pre>\n',
		section: 'List items',
	},
	{
		md: '1.     indented code\n\n   paragraph\n\n       more code\n',
		html: '<ol><li><pre><code>indented code\n</code></pre><p>paragraph</p><pre><code>more code\n</code></pre></li></ol>\n',
		section: 'List items',
	},
	{
		md: '1.      indented code\n\n   paragraph\n\n       more code\n',
		html: '<ol><li><pre><code> indented code\n</code></pre><p>paragraph</p><pre><code>more code\n</code></pre></li></ol>\n',
		section: 'List items',
	},
	{
		md: '   foo\n\nbar\n',
		html: '<p>foo</p><p>bar</p>\n',
		section: 'List items',
	},
	{
		md: '-    foo\n\n  bar\n',
		html: '<ul><li>foo</li></ul><p>bar</p>\n',
		section: 'List items',
	},
	{
		md: '-  foo\n\n   bar\n',
		html: '<ul><li><p>foo</p><p>bar</p></li></ul>\n',
		section: 'List items',
	},
	{
		md: '-\n  foo\n-\n  ```\n  bar\n  ```\n-\n      baz\n',
		html: '<ul><li>foo</li><li><pre><code>bar\n</code></pre></li><li><pre><code>baz\n</code></pre></li></ul>\n',
		section: 'List items',
	},
	{
		md: '-   \n  foo\n',
		html: '<ul><li>foo</li></ul>\n',
		section: 'List items',
	},
	{
		md: '-\n\n  foo\n',
		html: '<ul><li></li></ul><p>foo</p>\n',
		section: 'List items',
	},
	{
		md: '- foo\n-\n- bar\n',
		html: '<ul><li>foo</li><li></li><li>bar</li></ul>\n',
		section: 'List items',
	},
	{
		md: '- foo\n-   \n- bar\n',
		html: '<ul><li>foo</li><li></li><li>bar</li></ul>\n',
		section: 'List items',
	},
	{
		md: '1. foo\n2.\n3. bar\n',
		html: '<ol><li>foo</li><li></li><li>bar</li></ol>\n',
		section: 'List items',
	},
	{
		md: '*\n',
		html: '<ul><li></li></ul>\n',
		section: 'List items',
	},
	{
		md: 'foo\n*\n\nfoo\n1.\n',
		html: '<p>foo\n*</p>\n<p>foo\n1.</p>\n',
		section: 'List items',
	},
	{
		md: ' 1.  A paragraph\n     with two lines.\n\n         indented code\n\n     > A block quote.\n',
		html: '<ol><li><p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '  1.  A paragraph\n      with two lines.\n\n          indented code\n\n      > A block quote.\n',
		html: '<ol><li><p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '   1.  A paragraph\n       with two lines.\n\n           indented code\n\n       > A block quote.\n',
		html: '<ol><li><p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '    1.  A paragraph\n        with two lines.\n\n            indented code\n\n        > A block quote.\n',
		html: '<pre><code>1.  A paragraph\n    with two lines.\n\n        indented code\n\n    &gt; A block quote.\n</code></pre>\n',
		section: 'List items',
	},
	{
		md: '  1.  A paragraph\nwith two lines.\n\n          indented code\n\n      > A block quote.\n',
		html: '<ol><li><p>A paragraph\nwith two lines.</p><pre><code>indented code\n</code></pre><blockquote><p>A block quote.</p></blockquote></li></ol>\n',
		section: 'List items',
	},
	{
		md: '  1.  A paragraph\n    with two lines.\n',
		html: '<ol><li>A paragraph\nwith two lines.</li></ol>\n',
		section: 'List items',
	},
	{
		md: '> 1. > Blockquote\ncontinued here.\n',
		html: '<blockquote><ol><li><blockquote><p>Blockquote\ncontinued here.</p></blockquote></li></ol></blockquote>\n',
		section: 'List items',
	},
	{
		md: '> 1. > Blockquote\n> continued here.\n',
		html: '<blockquote><ol><li><blockquote><p>Blockquote\ncontinued here.</p></blockquote></li></ol></blockquote>\n',
		section: 'List items',
	},
	{
		md: '- foo\n  - bar\n    - baz\n      - boo\n',
		html: '<ul><li>foo\n<ul><li>bar\n<ul><li>baz\n<ul><li>boo</li></ul></li></ul></li></ul></li></ul>\n',
		section: 'List items',
	},
	{
		md: '- foo\n - bar\n  - baz\n   - boo\n',
		html: '<ul><li>foo</li><li>bar</li><li>baz</li><li>boo</li></ul>\n',
		section: 'List items',
	},
	{
		md: '10) foo\n    - bar\n',
		html: '<ol start="10"><li>foo\n<ul><li>bar</li></ul></li></ol>\n',
		section: 'List items',
	},
	{
		md: '10) foo\n   - bar\n',
		html: '<ol start="10"><li>foo</li></ol><ul><li>bar</li></ul>\n',
		section: 'List items',
	},
	{
		md: '- - foo\n',
		html: '<ul><li><ul><li>foo</li></ul></li></ul>\n',
		section: 'List items',
	},
	{
		md: '1. - 2. foo\n',
		html: '<ol><li><ul><li><ol start="2"><li>foo</li></ol></li></ul></li></ol>\n',
		section: 'List items',
	},
	{
		md: '- # Foo\n- Bar\n  ---\n  baz\n',
		html: '<ul><li><h1>Foo</h1></li><li><h2>Bar</h2>\nbaz</li></ul>\n',
		section: 'List items',
	},
	{
		md: '- foo\n- bar\n+ baz\n',
		html: '<ul><li>foo</li><li>bar</li></ul><ul><li>baz</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '1. foo\n2. bar\n3) baz\n',
		html: '<ol><li>foo</li><li>bar</li></ol><ol start="3"><li>baz</li></ol>\n',
		section: 'Lists',
	},
	{
		md: 'Foo\n- bar\n- baz\n',
		html: '<p>Foo</p><ul><li>bar</li><li>baz</li></ul>\n',
		section: 'Lists',
	},
	{
		md: 'The number of windows in my house is\n14.  The number of doors is 6.\n',
		html: '<p>The number of windows in my house is\n14.  The number of doors is 6.</p>\n',
		section: 'Lists',
	},
	{
		md: 'The number of windows in my house is\n1.  The number of doors is 6.\n',
		html: '<p>The number of windows in my house is</p><ol><li>The number of doors is 6.</li></ol>\n',
		section: 'Lists',
	},
	{
		md: '- foo\n\n- bar\n\n\n- baz\n',
		html: '<ul><li><p>foo</p></li><li><p>bar</p></li><li><p>baz</p></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- foo\n  - bar\n    - baz\n\n\n      bim\n',
		html: '<ul><li>foo\n<ul><li>bar\n<ul><li><p>baz</p><p>bim</p></li></ul></li></ul></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- foo\n- bar\n\n<!-- -->\n\n- baz\n- bim\n',
		html: '<ul><li>foo</li><li>bar</li></ul><!-- --><ul><li>baz</li><li>bim</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '-   foo\n\n    notcode\n\n-   foo\n\n<!-- -->\n\n    code\n',
		html: '<ul><li><p>foo</p>\n<p>notcode</p></li><li><p>foo</p></li></ul><!-- -->\n<pre><code>code\n</code></pre>\n',
		section: 'Lists',
	},
	{
		md: '- a\n - b\n  - c\n   - d\n  - e\n - f\n- g\n',
		html: '<ul><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li><li>f</li><li>g</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '1. a\n\n  2. b\n\n   3. c\n',
		html: '<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol>\n',
		section: 'Lists',
	},
	{
		md: '- a\n - b\n  - c\n   - d\n    - e\n',
		html: '<ul><li>a</li><li>b</li><li>c</li><li>d\n- e</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '1. a\n\n  2. b\n\n    3. c\n',
		html: '<ol><li><p>a</p></li><li><p>b</p></li></ol><pre><code>3. c\n</code></pre>\n',
		section: 'Lists',
	},
	{
		md: '- a\n- b\n\n- c\n',
		html: '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '* a\n*\n\n* c\n',
		html: '<ul><li><p>a</p></li><li></li><li><p>c</p></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n- b\n\n  c\n- d\n',
		html: '<ul><li><p>a</p>\n</li><li><p>b</p><p>c</p></li><li><p>d</p></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n- b\n\n  [ref]: /url\n- d\n',
		html: '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>d</p>\n</li>\n</ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n- ```\n  b\n\n\n  ```\n- c\n',
		html: '<ul><li>a</li><li>\n<pre><code>b\n\n\n</code></pre></li><li>c</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n  - b\n\n    c\n- d\n',
		html: '<ul><li>a\n<ul><li><p>b</p><p>c</p></li></ul></li><li>d</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '* a\n  > b\n  >\n* c\n',
		html: '<ul><li>a\n<blockquote><p>b</p>\n</blockquote></li><li>c</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n  > b\n  ```\n  c\n  ```\n- d\n',
		html: '<ul><li>a\n<blockquote><p>b</p></blockquote><pre><code>c\n</code></pre></li><li>d</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n',
		html: '<ul><li>a</li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n  - b\n',
		html: '<ul><li>a\n<ul><li>b</li></ul></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '1. ```\n   foo\n   ```\n\n   bar\n',
		html: '<ol><li><pre><code>foo\n</code></pre><p>bar</p></li></ol>\n',
		section: 'Lists',
	},
	{
		md: '* foo\n  * bar\n\n  baz\n',
		html: '<ul><li><p>foo</p><ul><li>bar</li></ul><p>baz</p></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '- a\n  - b\n  - c\n\n- d\n  - e\n  - f\n',
		html: '<ul><li><p>a</p><ul><li>b</li><li>c</li></ul></li><li><p>d</p><ul><li>e</li><li>f</li></ul></li></ul>\n',
		section: 'Lists',
	},
	{
		md: '`hi`lo`\n',
		html: '<p><code>hi</code>lo`</p>\n',
		section: 'Inlines',
	},
	{
		md: '`foo`\n',
		html: '<p><code>foo</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '`` foo ` bar ``\n',
		html: '<p><code>foo ` bar</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '` `` `\n',
		html: '<p><code>``</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '`  ``  `\n',
		html: '<p><code> `` </code></p>\n',
		section: 'Code spans',
	},
	{
		md: '` a`\n',
		html: '<p><code> a</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '` b `\n',
		html: '<p><code> b </code></p>\n',
		section: 'Code spans',
	},
	{
		md: '` `\n`  `\n',
		html: '<p><code> </code>\n<code>  </code></p>\n',
		section: 'Code spans',
	},
	{
		md: '``\nfoo\nbar  \nbaz\n``\n',
		html: '<p><code>foo bar   baz</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '``\nfoo \n``\n',
		html: '<p><code>foo </code></p>\n',
		section: 'Code spans',
	},
	{
		md: '`foo   bar \nbaz`\n',
		html: '<p><code>foo   bar  baz</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '`foo\\`bar`\n',
		html: '<p><code>foo\\</code>bar`</p>\n',
		section: 'Code spans',
	},
	{
		md: '``foo`bar``\n',
		html: '<p><code>foo`bar</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '` foo `` bar `\n',
		html: '<p><code>foo `` bar</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '*foo`*`\n',
		html: '<p>*foo<code>*</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '[not a `link](/foo`)\n',
		html: '<p>[not a <code>link](/foo</code>)</p>\n',
		section: 'Code spans',
	},
	{
		md: '`<a href="`">`\n',
		html: '<p><code>&lt;a href=&quot;</code>&quot;&gt;`</p>\n',
		section: 'Code spans',
	},
	{
		md: '<a href="`">`\n',
		html: '<p><a href="`">`</p>\n',
		section: 'Code spans',
	},
	{
		md: '`<https://foo.bar.`baz>`\n',
		html: '<p><code>&lt;https://foo.bar.</code>baz&gt;`</p>\n',
		section: 'Code spans',
	},
	{
		md: '<https://foo.bar.`baz>`\n',
		html: '<p><a href="https://foo.bar.%60baz">https://foo.bar.`baz</a>`</p>\n',
		section: 'Code spans',
	},
	{
		md: '```foo``\n',
		html: '<p>```foo``</p>\n',
		section: 'Code spans',
	},
	{
		md: '`foo\n',
		html: '<p>`foo</p>\n',
		section: 'Code spans',
	},
	{
		md: '`foo``bar``\n',
		html: '<p>`foo<code>bar</code></p>\n',
		section: 'Code spans',
	},
	{
		md: '*foo bar*\n',
		html: '<p><em>foo bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'a * foo bar*\n',
		html: '<p>a * foo bar*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'a*"foo"*\n',
		html: '<p>a*&quot;foo&quot;*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '* a *\n',
		html: '<p>* a *</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*$*alpha.\n\n*£*bravo.\n\n*€*charlie.\n',
		html: '<p>*$*alpha.</p>\n<p>*£*bravo.</p>\n<p>*€*charlie.</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo*bar*\n',
		html: '<p>foo<em>bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '5*6*78\n',
		html: '<p>5<em>6</em>78</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo bar_\n',
		html: '<p><em>foo bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_ foo bar_\n',
		html: '<p>_ foo bar_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'a_"foo"_\n',
		html: '<p>a_&quot;foo&quot;_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo_bar_\n',
		html: '<p>foo_bar_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '5_6_78\n',
		html: '<p>5_6_78</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'пристаням_стремятся_\n',
		html: '<p>пристаням_стремятся_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'aa_"bb"_cc\n',
		html: '<p>aa_&quot;bb&quot;_cc</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo-_(bar)_\n',
		html: '<p>foo-<em>(bar)</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo*\n',
		html: '<p>_foo*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo bar *\n',
		html: '<p>*foo bar *</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo bar\n*\n',
		html: '<p>*foo bar\n*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*(*foo)\n',
		html: '<p>*(*foo)</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*(*foo*)*\n',
		html: '<p><em>(<em>foo</em>)</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo*bar\n',
		html: '<p><em>foo</em>bar</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo bar _\n',
		html: '<p>_foo bar _</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_(_foo)\n',
		html: '<p>_(_foo)</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_(_foo_)_\n',
		html: '<p><em>(<em>foo</em>)</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo_bar\n',
		html: '<p>_foo_bar</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_пристаням_стремятся\n',
		html: '<p>_пристаням_стремятся</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo_bar_baz_\n',
		html: '<p><em>foo_bar_baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_(bar)_.\n',
		html: '<p><em>(bar)</em>.</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo bar**\n',
		html: '<p><strong>foo bar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '** foo bar**\n',
		html: '<p>** foo bar**</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'a**"foo"**\n',
		html: '<p>a**&quot;foo&quot;**</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo**bar**\n',
		html: '<p>foo<strong>bar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo bar__\n',
		html: '<p><strong>foo bar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__ foo bar__\n',
		html: '<p>__ foo bar__</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__\nfoo bar__\n',
		html: '<p>__\nfoo bar__</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'a__"foo"__\n',
		html: '<p>a__&quot;foo&quot;__</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo__bar__\n',
		html: '<p>foo__bar__</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '5__6__78\n',
		html: '<p>5__6__78</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'пристаням__стремятся__\n',
		html: '<p>пристаням__стремятся__</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo, __bar__, baz__\n',
		html: '<p><strong>foo, <strong>bar</strong>, baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo-__(bar)__\n',
		html: '<p>foo-<strong>(bar)</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo bar **\n',
		html: '<p>**foo bar **</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**(**foo)\n',
		html: '<p>**(**foo)</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*(**foo**)*\n',
		html: '<p><em>(<strong>foo</strong>)</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**Gomphocarpus (*Gomphocarpus physocarpus*, syn.\n*Asclepias physocarpa*)**\n',
		html: '<p><strong>Gomphocarpus (<em>Gomphocarpus physocarpus</em>, syn.\n<em>Asclepias physocarpa</em>)</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo "*bar*" foo**\n',
		html: '<p><strong>foo &quot;<em>bar</em>&quot; foo</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo**bar\n',
		html: '<p><strong>foo</strong>bar</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo bar __\n',
		html: '<p>__foo bar __</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__(__foo)\n',
		html: '<p>__(__foo)</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_(__foo__)_\n',
		html: '<p><em>(<strong>foo</strong>)</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo__bar\n',
		html: '<p>__foo__bar</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__пристаням__стремятся\n',
		html: '<p>__пристаням__стремятся</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo__bar__baz__\n',
		html: '<p><strong>foo__bar__baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__(bar)__.\n',
		html: '<p><strong>(bar)</strong>.</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo [bar](/url)*\n',
		html: '<p><em>foo <a href="/url">bar</a></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo\nbar*\n',
		html: '<p><em>foo\nbar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo __bar__ baz_\n',
		html: '<p><em>foo <strong>bar</strong> baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo _bar_ baz_\n',
		html: '<p><em>foo <em>bar</em> baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo_ bar_\n',
		html: '<p><em><em>foo</em> bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo *bar**\n',
		html: '<p><em>foo <em>bar</em></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo **bar** baz*\n',
		html: '<p><em>foo <strong>bar</strong> baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo**bar**baz*\n',
		html: '<p><em>foo<strong>bar</strong>baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo**bar*\n',
		html: '<p><em>foo**bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '***foo** bar*\n',
		html: '<p><em><strong>foo</strong> bar</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo **bar***\n',
		html: '<p><em>foo <strong>bar</strong></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo**bar***\n',
		html: '<p><em>foo<strong>bar</strong></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo***bar***baz\n',
		html: '<p>foo<em><strong>bar</strong></em>baz</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo******bar*********baz\n',
		html: '<p>foo<strong><strong><strong>bar</strong></strong></strong>***baz</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo **bar *baz* bim** bop*\n',
		html: '<p><em>foo <strong>bar <em>baz</em> bim</strong> bop</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo [*bar*](/url)*\n',
		html: '<p><em>foo <a href="/url"><em>bar</em></a></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '** is not an empty emphasis\n',
		html: '<p>** is not an empty emphasis</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**** is not an empty strong emphasis\n',
		html: '<p>**** is not an empty strong emphasis</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo [bar](/url)**\n',
		html: '<p><strong>foo <a href="/url">bar</a></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo\nbar**\n',
		html: '<p><strong>foo\nbar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo _bar_ baz__\n',
		html: '<p><strong>foo <em>bar</em> baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo __bar__ baz__\n',
		html: '<p><strong>foo <strong>bar</strong> baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '____foo__ bar__\n',
		html: '<p><strong><strong>foo</strong> bar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo **bar****\n',
		html: '<p><strong>foo <strong>bar</strong></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo *bar* baz**\n',
		html: '<p><strong>foo <em>bar</em> baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo*bar*baz**\n',
		html: '<p><strong>foo<em>bar</em>baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '***foo* bar**\n',
		html: '<p><strong><em>foo</em> bar</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo *bar***\n',
		html: '<p><strong>foo <em>bar</em></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo *bar **baz**\nbim* bop**\n',
		html: '<p><strong>foo <em>bar <strong>baz</strong>\nbim</em> bop</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo [*bar*](/url)**\n',
		html: '<p><strong>foo <a href="/url"><em>bar</em></a></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__ is not an empty emphasis\n',
		html: '<p>__ is not an empty emphasis</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '____ is not an empty strong emphasis\n',
		html: '<p>____ is not an empty strong emphasis</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo ***\n',
		html: '<p>foo ***</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo *\\**\n',
		html: '<p>foo <em>*</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo *_*\n',
		html: '<p>foo <em>_</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo *****\n',
		html: '<p>foo *****</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo **\\***\n',
		html: '<p>foo <strong>*</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo **_**\n',
		html: '<p>foo <strong>_</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo*\n',
		html: '<p>*<em>foo</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo**\n',
		html: '<p><em>foo</em>*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '***foo**\n',
		html: '<p>*<strong>foo</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '****foo*\n',
		html: '<p>***<em>foo</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo***\n',
		html: '<p><strong>foo</strong>*</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo****\n',
		html: '<p><em>foo</em>***</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo ___\n',
		html: '<p>foo ___</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo _\\__\n',
		html: '<p>foo <em>_</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo _*_\n',
		html: '<p>foo <em>*</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo _____\n',
		html: '<p>foo _____</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo __\\___\n',
		html: '<p>foo <strong>_</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: 'foo __*__\n',
		html: '<p>foo <strong>*</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo_\n',
		html: '<p>_<em>foo</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo__\n',
		html: '<p><em>foo</em>_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '___foo__\n',
		html: '<p>_<strong>foo</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '____foo_\n',
		html: '<p>___<em>foo</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo___\n',
		html: '<p><strong>foo</strong>_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo____\n',
		html: '<p><em>foo</em>___</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo**\n',
		html: '<p><strong>foo</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*_foo_*\n',
		html: '<p><em><em>foo</em></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__foo__\n',
		html: '<p><strong>foo</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_*foo*_\n',
		html: '<p><em><em>foo</em></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '****foo****\n',
		html: '<p><strong><strong>foo</strong></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '____foo____\n',
		html: '<p><strong><strong>foo</strong></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '******foo******\n',
		html: '<p><strong><strong><strong>foo</strong></strong></strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '***foo***\n',
		html: '<p><em><strong>foo</strong></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_____foo_____\n',
		html: '<p><em><strong><strong>foo</strong></strong></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo _bar* baz_\n',
		html: '<p><em>foo _bar</em> baz_</p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo __bar *baz bim__ bam*\n',
		html: '<p><em>foo <strong>bar *baz bim</strong> bam</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**foo **bar baz**\n',
		html: '<p>**foo <strong>bar baz</strong></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*foo *bar baz*\n',
		html: '<p>*foo <em>bar baz</em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*[bar*](/url)\n',
		html: '<p>*<a href="/url">bar*</a></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_foo [bar_](/url)\n',
		html: '<p>_foo <a href="/url">bar_</a></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*<img src="foo" title="*"/>\n',
		html: '<p>*<img src="foo" title="*"/></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**<a href="**">\n',
		html: '<p>**<a href="**"></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__<a href="__">\n',
		html: '<p>__<a href="__"></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '*a `*`*\n',
		html: '<p><em>a <code>*</code></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '_a `_`_\n',
		html: '<p><em>a <code>_</code></em></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '**a<https://foo.bar/?q=**>\n',
		html: '<p>**a<a href="https://foo.bar/?q=**">https://foo.bar/?q=**</a></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '__a<https://foo.bar/?q=__>\n',
		html: '<p>__a<a href="https://foo.bar/?q=__">https://foo.bar/?q=__</a></p>\n',
		section: 'Emphasis and strong emphasis',
	},
	{
		md: '[link](/uri "title")\n',
		html: '<p><a href="/uri" title="title">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/uri)\n',
		html: '<p><a href="/uri">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[](./target.md)\n',
		html: '<p><a href="./target.md"></a></p>\n',
		section: 'Links',
	},
	{
		md: '[link]()\n',
		html: '<p><a href="">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](<>)\n',
		html: '<p><a href="">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[]()\n',
		html: '<p><a href=""></a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/my uri)\n',
		html: '<p>[link](/my uri)</p>\n',
		section: 'Links',
	},
	{
		md: '[link](</my uri>)\n',
		html: '<p><a href="/my%20uri">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo\nbar)\n',
		html: '<p>[link](foo\nbar)</p>\n',
		section: 'Links',
	},
	{
		md: '[link](<foo\nbar>)\n',
		html: '<p>[link](<foo\nbar>)</p>\n',
		section: 'Links',
	},
	{
		md: '[a](<b)c>)\n',
		html: '<p><a href="b)c">a</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](<foo\\>)\n',
		html: '<p>[link](&lt;foo&gt;)</p>\n',
		section: 'Links',
	},
	{
		md: '[a](<b)c\n[a](<b)c>\n[a](<b>c)\n',
		html: '<p>[a](&lt;b)c\n[a](&lt;b)c&gt;\n[a](<b>c)</p>\n',
		section: 'Links',
	},
	{
		md: '[link](\\(foo\\))\n',
		html: '<p><a href="(foo)">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo(and(bar)))\n',
		html: '<p><a href="foo(and(bar))">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo(and(bar))\n',
		html: '<p>[link](foo(and(bar))</p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo\\(and\\(bar\\))\n',
		html: '<p><a href="foo(and(bar)">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](<foo(and(bar)>)\n',
		html: '<p><a href="foo(and(bar)">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo\\)\\:)\n',
		html: '<p><a href="foo):">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](#fragment)\n\n[link](https://example.com#fragment)\n\n[link](https://example.com?foo=3#frag)\n',
		html: '<p><a href="#fragment">link</a></p>\n<p><a href="https://example.com#fragment">link</a></p>\n<p><a href="https://example.com?foo=3#frag">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo\\bar)\n',
		html: '<p><a href="foo%5Cbar">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](foo%20b&auml;)\n',
		html: '<p><a href="foo%20b%C3%A4">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link]("title")\n',
		html: '<p><a href="%22title%22">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/url "title")\n[link](/url \'title\')\n[link](/url (title))\n',
		html: '<p><a href="/url" title="title">link</a>\n<a href="/url" title="title">link</a>\n<a href="/url" title="title">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/url "title \\"&quot;")\n',
		html: '<p><a href="/url" title="title &quot;&quot;">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/url "title")\n',
		html: '<p><a href="/url%C2%A0%22title%22">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](/url "title "and" title")\n',
		html: '<p>[link](/url &quot;title &quot;and&quot; title&quot;)</p>\n',
		section: 'Links',
	},
	{
		md: '[link](/url \'title "and" title\')\n',
		html: '<p><a href="/url" title="title &quot;and&quot; title">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link](   /uri\n  "title"  )\n',
		html: '<p><a href="/uri" title="title">link</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link] (/uri)\n',
		html: '<p>[link] (/uri)</p>\n',
		section: 'Links',
	},
	{
		md: '[link [foo [bar]]](/uri)\n',
		html: '<p><a href="/uri">link [foo [bar]]</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link] bar](/uri)\n',
		html: '<p>[link] bar](/uri)</p>\n',
		section: 'Links',
	},
	{
		md: '[link [bar](/uri)\n',
		html: '<p>[link <a href="/uri">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link \\[bar](/uri)\n',
		html: '<p><a href="/uri">link [bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link *foo **bar** `#`*](/uri)\n',
		html: '<p><a href="/uri">link <em>foo <strong>bar</strong> <code>#</code></em></a></p>\n',
		section: 'Links',
	},
	{
		md: '[![moon](moon.jpg)](/uri)\n',
		html: '<p><a href="/uri"><img src="moon.jpg" alt="moon" /></a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo [bar](/uri)](/uri)\n',
		html: '<p>[foo <a href="/uri">bar</a>](/uri)</p>\n',
		section: 'Links',
	},
	{
		md: '[foo *[bar [baz](/uri)](/uri)*](/uri)\n',
		html: '<p>[foo <em>[bar <a href="/uri">baz</a>](/uri)</em>](/uri)</p>\n',
		section: 'Links',
	},
	{
		md: '![[[foo](uri1)](uri2)](uri3)\n',
		html: '<p><img src="uri3" alt="[foo](uri2)" /></p>\n',
		section: 'Links',
	},
	{
		md: '*[foo*](/uri)\n',
		html: '<p>*<a href="/uri">foo*</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo *bar](baz*)\n',
		html: '<p><a href="baz*">foo *bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '*foo [bar* baz]\n',
		html: '<p><em>foo [bar</em> baz]</p>\n',
		section: 'Links',
	},
	{
		md: '[foo <bar attr="](baz)">\n',
		html: '<p>[foo <bar attr="](baz)"></p>\n',
		section: 'Links',
	},
	{
		md: '[foo`](/uri)`\n',
		html: '<p>[foo<code>](/uri)</code></p>\n',
		section: 'Links',
	},
	{
		md: '[foo<https://example.com/?search=](uri)>\n',
		html: '<p>[foo<a href="https://example.com/?search=%5D(uri)">https://example.com/?search=](uri)</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][bar]\n\n[bar]: /url "title"\n',
		html: '<p><a href="/url" title="title">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link [foo [bar]]][ref]\n\n[ref]: /uri\n',
		html: '<p><a href="/uri">link [foo [bar]]</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link \\[bar][ref]\n\n[ref]: /uri\n',
		html: '<p><a href="/uri">link [bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[link *foo **bar** `#`*][ref]\n\n[ref]: /uri\n',
		html: '<p><a href="/uri">link <em>foo <strong>bar</strong> <code>#</code></em></a></p>\n',
		section: 'Links',
	},
	{
		md: '[![moon](moon.jpg)][ref]\n\n[ref]: /uri\n',
		html: '<p><a href="/uri"><img src="moon.jpg" alt="moon" /></a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo [bar](/uri)][ref]\n\n[ref]: /uri\n',
		html: '<p>[foo <a href="/uri">bar</a>]<a href="/uri">ref</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo *bar [baz][ref]*][ref]\n\n[ref]: /uri\n',
		html: '<p>[foo <em>bar <a href="/uri">baz</a></em>]<a href="/uri">ref</a></p>\n',
		section: 'Links',
	},
	{
		md: '*[foo*][ref]\n\n[ref]: /uri\n',
		html: '<p>*<a href="/uri">foo*</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo *bar][ref]*\n\n[ref]: /uri\n',
		html: '<p><a href="/uri">foo *bar</a>*</p>\n',
		section: 'Links',
	},
	{
		md: '[foo <bar attr="][ref]">\n\n[ref]: /uri\n',
		html: '<p>[foo <bar attr="][ref]"></p>\n',
		section: 'Links',
	},
	{
		md: '[foo`][ref]`\n\n[ref]: /uri\n',
		html: '<p>[foo<code>][ref]</code></p>\n',
		section: 'Links',
	},
	{
		md: '[foo<https://example.com/?search=][ref]>\n\n[ref]: /uri\n',
		html: '<p>[foo<a href="https://example.com/?search=%5D%5Bref%5D">https://example.com/?search=][ref]</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][BaR]\n\n[bar]: /url "title"\n',
		html: '<p><a href="/url" title="title">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[ẞ]\n\n[SS]: /url\n',
		html: '<p><a href="/url">ẞ</a></p>\n',
		section: 'Links',
	},
	{
		md: '[Foo\n  bar]: /url\n\n[Baz][Foo bar]\n',
		html: '<p><a href="/url">Baz</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo] [bar]\n\n[bar]: /url "title"\n',
		html: '<p>[foo] <a href="/url" title="title">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo]\n[bar]\n\n[bar]: /url "title"\n',
		html: '<p>[foo]\n<a href="/url" title="title">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo]: /url1\n\n[foo]: /url2\n\n[bar][foo]\n',
		html: '<p><a href="/url1">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[bar][foo\\!]\n\n[foo!]: /url\n',
		html: '<p>[bar][foo!]</p>\n',
		section: 'Links',
	},
	{
		md: '[foo][ref[]\n\n[ref[]: /uri\n',
		html: '<p>[foo][ref[]</p>\n<p>[ref[]: /uri</p>\n',
		section: 'Links',
	},
	{
		md: '[foo][ref[bar]]\n\n[ref[bar]]: /uri\n',
		html: '<p>[foo][ref[bar]]</p>\n<p>[ref[bar]]: /uri</p>\n',
		section: 'Links',
	},
	{
		md: '[[[foo]]]\n\n[[[foo]]]: /url\n',
		html: '<p>[[[foo]]]</p>\n<p>[[[foo]]]: /url</p>\n',
		section: 'Links',
	},
	{
		md: '[foo][ref\\[]\n\n[ref\\[]: /uri\n',
		html: '<p><a href="/uri">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[bar\\\\]: /uri\n\n[bar\\\\]\n',
		html: '<p><a href="/uri">bar\\</a></p>\n',
		section: 'Links',
	},
	{
		md: '[]\n\n[]: /uri\n',
		html: '<p>[]</p>\n<p>[]: /uri</p>\n',
		section: 'Links',
	},
	{
		md: '[\n ]\n\n[\n ]: /uri\n',
		html: '<p>[\n]</p>\n<p>[\n]: /uri</p>\n',
		section: 'Links',
	},
	{
		md: '[foo][]\n\n[foo]: /url "title"\n',
		html: '<p><a href="/url" title="title">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[*foo* bar][]\n\n[*foo* bar]: /url "title"\n',
		html: '<p><a href="/url" title="title"><em>foo</em> bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[Foo][]\n\n[foo]: /url "title"\n',
		html: '<p><a href="/url" title="title">Foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo] \n[]\n\n[foo]: /url "title"\n',
		html: '<p><a href="/url" title="title">foo</a>\n[]</p>\n',
		section: 'Links',
	},
	{
		md: '[foo]\n\n[foo]: /url "title"\n',
		html: '<p><a href="/url" title="title">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[*foo* bar]\n\n[*foo* bar]: /url "title"\n',
		html: '<p><a href="/url" title="title"><em>foo</em> bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[[*foo* bar]]\n\n[*foo* bar]: /url "title"\n',
		html: '<p>[<a href="/url" title="title"><em>foo</em> bar</a>]</p>\n',
		section: 'Links',
	},
	{
		md: '[[bar [foo]\n\n[foo]: /url\n',
		html: '<p>[[bar <a href="/url">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[Foo]\n\n[foo]: /url "title"\n',
		html: '<p><a href="/url" title="title">Foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo] bar\n\n[foo]: /url\n',
		html: '<p><a href="/url">foo</a> bar</p>\n',
		section: 'Links',
	},
	{
		md: '\\[foo]\n\n[foo]: /url "title"\n',
		html: '<p>[foo]</p>\n',
		section: 'Links',
	},
	{
		md: '[foo*]: /url\n\n*[foo*]\n',
		html: '<p>*<a href="/url">foo*</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][bar]\n\n[foo]: /url1\n[bar]: /url2\n',
		html: '<p><a href="/url2">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][]\n\n[foo]: /url1\n',
		html: '<p><a href="/url1">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo]()\n\n[foo]: /url1\n',
		html: '<p><a href="">foo</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo](not a link)\n\n[foo]: /url1\n',
		html: '<p><a href="/url1">foo</a>(not a link)</p>\n',
		section: 'Links',
	},
	{
		md: '[foo][bar][baz]\n\n[baz]: /url\n',
		html: '<p>[foo]<a href="/url">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][bar][baz]\n\n[baz]: /url1\n[bar]: /url2\n',
		html: '<p><a href="/url2">foo</a><a href="/url1">baz</a></p>\n',
		section: 'Links',
	},
	{
		md: '[foo][bar][baz]\n\n[baz]: /url1\n[foo]: /url2\n',
		html: '<p>[foo]<a href="/url1">bar</a></p>\n',
		section: 'Links',
	},
	{
		md: '![foo](/url "title")\n',
		html: '<p><img src="/url" alt="foo" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo *bar*]\n\n[foo *bar*]: train.jpg "train & tracks"\n',
		html: '<p><img src="train.jpg" alt="foo bar" title="train &amp; tracks" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo ![bar](/url)](/url2)\n',
		html: '<p><img src="/url2" alt="foo bar" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo [bar](/url)](/url2)\n',
		html: '<p><img src="/url2" alt="foo bar" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo *bar*][]\n\n[foo *bar*]: train.jpg "train & tracks"\n',
		html: '<p><img src="train.jpg" alt="foo bar" title="train &amp; tracks" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo *bar*][foobar]\n\n[FOOBAR]: train.jpg "train & tracks"\n',
		html: '<p><img src="train.jpg" alt="foo bar" title="train &amp; tracks" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo](train.jpg)\n',
		html: '<p><img src="train.jpg" alt="foo" /></p>\n',
		section: 'Images',
	},
	{
		md: 'My ![foo bar](/path/to/train.jpg  "title"   )\n',
		html: '<p>My <img src="/path/to/train.jpg" alt="foo bar" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo](<url>)\n',
		html: '<p><img src="url" alt="foo" /></p>\n',
		section: 'Images',
	},
	{
		md: '![](/url)\n',
		html: '<p><img src="/url" alt="" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo][bar]\n\n[bar]: /url\n',
		html: '<p><img src="/url" alt="foo" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo][bar]\n\n[BAR]: /url\n',
		html: '<p><img src="/url" alt="foo" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo][]\n\n[foo]: /url "title"\n',
		html: '<p><img src="/url" alt="foo" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![*foo* bar][]\n\n[*foo* bar]: /url "title"\n',
		html: '<p><img src="/url" alt="foo bar" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![Foo][]\n\n[foo]: /url "title"\n',
		html: '<p><img src="/url" alt="Foo" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![foo] \n[]\n\n[foo]: /url "title"\n',
		html: '<p><img src="/url" alt="foo" title="title" />\n[]</p>\n',
		section: 'Images',
	},
	{
		md: '![foo]\n\n[foo]: /url "title"\n',
		html: '<p><img src="/url" alt="foo" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![*foo* bar]\n\n[*foo* bar]: /url "title"\n',
		html: '<p><img src="/url" alt="foo bar" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '![[foo]]\n\n[[foo]]: /url "title"\n',
		html: '<p>![[foo]]</p>\n<p>[[foo]]: /url &quot;title&quot;</p>\n',
		section: 'Images',
	},
	{
		md: '![Foo]\n\n[foo]: /url "title"\n',
		html: '<p><img src="/url" alt="Foo" title="title" /></p>\n',
		section: 'Images',
	},
	{
		md: '!\\[foo]\n\n[foo]: /url "title"\n',
		html: '<p>![foo]</p>\n',
		section: 'Images',
	},
	{
		md: '\\![foo]\n\n[foo]: /url "title"\n',
		html: '<p>!<a href="/url" title="title">foo</a></p>\n',
		section: 'Images',
	},
	{
		md: '<http://foo.bar.baz>\n',
		html: '<p><a href="http://foo.bar.baz">http://foo.bar.baz</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<https://foo.bar.baz/test?q=hello&id=22&boolean>\n',
		html: '<p><a href="https://foo.bar.baz/test?q=hello&amp;id=22&amp;boolean">https://foo.bar.baz/test?q=hello&amp;id=22&amp;boolean</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<irc://foo.bar:2233/baz>\n',
		html: '<p><a href="irc://foo.bar:2233/baz">irc://foo.bar:2233/baz</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<MAILTO:FOO@BAR.BAZ>\n',
		html: '<p><a href="MAILTO:FOO@BAR.BAZ">MAILTO:FOO@BAR.BAZ</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<a+b+c:d>\n',
		html: '<p><a href="a+b+c:d">a+b+c:d</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<made-up-scheme://foo,bar>\n',
		html: '<p><a href="made-up-scheme://foo,bar">made-up-scheme://foo,bar</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<https://../>\n',
		html: '<p><a href="https://../">https://../</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<localhost:5001/foo>\n',
		html: '<p><a href="localhost:5001/foo">localhost:5001/foo</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<https://foo.bar/baz bim>\n',
		html: '<p>&lt;https://foo.bar/baz bim&gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: '<https://example.com/\\[\\>\n',
		html: '<p><a href="https://example.com/%5C%5B%5C">https://example.com/\\[\\</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<foo@bar.example.com>\n',
		html: '<p><a href="mailto:foo@bar.example.com">foo@bar.example.com</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<foo+special@Bar.baz-bar0.com>\n',
		html: '<p><a href="mailto:foo+special@Bar.baz-bar0.com">foo+special@Bar.baz-bar0.com</a></p>\n',
		section: 'Autolinks',
	},
	{
		md: '<foo\\+@bar.example.com>\n',
		html: '<p>&lt;foo+@bar.example.com&gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: '<>\n',
		html: '<p>&lt;&gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: '< https://foo.bar >\n',
		html: '<p>&lt; https://foo.bar &gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: '<m:abc>\n',
		html: '<p>&lt;m:abc&gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: '<foo.bar.baz>\n',
		html: '<p>&lt;foo.bar.baz&gt;</p>\n',
		section: 'Autolinks',
	},
	{
		md: 'https://example.com\n',
		html: '<p>https://example.com</p>\n',
		section: 'Autolinks',
	},
	{
		md: 'foo@bar.example.com\n',
		html: '<p>foo@bar.example.com</p>\n',
		section: 'Autolinks',
	},
	{
		md: '<a><bab><c2c>\n',
		html: '<p><a><bab><c2c></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<a/><b2/>\n',
		html: '<p><a/><b2/></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<a  /><b2\ndata="foo" >\n',
		html: '<p><a  /><b2\ndata="foo" ></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<a foo="bar" bam = \'baz <em>"</em>\'\n_boolean zoop:33=zoop:33 />\n',
		html: '<p><a foo="bar" bam = \'baz <em>"</em>\'\n_boolean zoop:33=zoop:33 /></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'Foo <responsive-image src="foo.jpg" />\n',
		html: '<p>Foo <responsive-image src="foo.jpg" /></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<33> <__>\n',
		html: '<p>&lt;33&gt; &lt;__&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<a h*#ref="hi">\n',
		html: '<p>&lt;a h*#ref=&quot;hi&quot;&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: "<a href=\"hi'> <a href=hi'>\n",
		html: "<p>&lt;a href=&quot;hi'&gt; &lt;a href=hi'&gt;</p>\n",
		section: 'Raw HTML',
	},
	{
		md: '< a><\nfoo><bar/ >\n<foo bar=baz\nbim!bop />\n',
		html: '<p>&lt; a&gt;&lt;\nfoo&gt;&lt;bar/ &gt;\n&lt;foo bar=baz\nbim!bop /&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: "<a href='bar'title=title>\n",
		html: "<p>&lt;a href='bar'title=title&gt;</p>\n",
		section: 'Raw HTML',
	},
	{
		md: '</a></foo >\n',
		html: '<p></a></foo ></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '</a href="foo">\n',
		html: '<p>&lt;/a href=&quot;foo&quot;&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <!-- this is a --\ncomment - with hyphens -->\n',
		html: '<p>foo <!-- this is a --\ncomment - with hyphens --></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <!--> foo -->\n\nfoo <!---> foo -->\n',
		html: '<p>foo <!--> foo --&gt;</p>\n<p>foo <!---> foo --&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <?php echo $a; ?>\n',
		html: '<p>foo <?php echo $a; ?></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <!ELEMENT br EMPTY>\n',
		html: '<p>foo <!ELEMENT br EMPTY></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <![CDATA[>&<]]>\n',
		html: '<p>foo <![CDATA[>&<]]></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <a href="&ouml;">\n',
		html: '<p>foo <a href="&ouml;"></p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo <a href="\\*">\n',
		html: '<p>foo <a href="\\*"></p>\n',
		section: 'Raw HTML',
	},
	{
		md: '<a href="\\"">\n',
		html: '<p>&lt;a href=&quot;&quot;&quot;&gt;</p>\n',
		section: 'Raw HTML',
	},
	{
		md: 'foo  \nbaz\n',
		html: '<p>foo<br />\nbaz</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo\\\nbaz\n',
		html: '<p>foo<br />\nbaz</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo       \nbaz\n',
		html: '<p>foo<br />\nbaz</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo  \n     bar\n',
		html: '<p>foo<br />\nbar</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo\\\n     bar\n',
		html: '<p>foo<br />\nbar</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '*foo  \nbar*\n',
		html: '<p><em>foo<br />\nbar</em></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '*foo\\\nbar*\n',
		html: '<p><em>foo<br />\nbar</em></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '`code  \nspan`\n',
		html: '<p><code>code   span</code></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '`code\\\nspan`\n',
		html: '<p><code>code\\ span</code></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '<a href="foo  \nbar">\n',
		html: '<p><a href="foo  \nbar"></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '<a href="foo\\\nbar">\n',
		html: '<p><a href="foo\\\nbar"></p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo\\\n',
		html: '<p>foo\\</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo  \n',
		html: '<p>foo</p>\n',
		section: 'Hard line breaks',
	},
	{
		md: '### foo\\\n',
		html: '<h3>foo\\</h3>\n',
		section: 'Hard line breaks',
	},
	{
		md: '### foo  \n',
		html: '<h3>foo</h3>\n',
		section: 'Hard line breaks',
	},
	{
		md: 'foo\nbaz\n',
		html: '<p>foo\nbaz</p>\n',
		section: 'Soft line breaks',
	},
	{
		md: 'foo \n baz\n',
		html: '<p>foo\nbaz</p>\n',
		section: 'Soft line breaks',
	},
	{
		md: "hello $.;'there\n",
		html: "<p>hello $.;'there</p>\n",
		section: 'Textual content',
	},
	{
		md: 'Foo χρῆν\n',
		html: '<p>Foo χρῆν</p>\n',
		section: 'Textual content',
	},
	{
		md: 'Multiple     spaces\n',
		html: '<p>Multiple     spaces</p>\n',
		section: 'Textual content',
	},
];
