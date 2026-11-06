Basic examples in rs4, html, socialcalc and rendered png.

In rs4 XML, nodes are divided into <segment> elements (EDUs containing text, leaves in the tree) and <group> elements (non-terminals). Each non-terminal has a type: 'span' or 'multinuc', with the latter having multiple coordinated children with the same relation under them. Secondary edges can break the tree constraint and are defined directly in secedge elements indicating edge source and target. Signal elements indicate the array of possibly non-contiguous and possibly empty token IDs they point to (1-based) and a signal type and subtype.

In the SocialCalc format: EDUs are a non-overlapping tiling of the document into discourse units as spans in the spreadsheet covering relevant tokens. Their contents start with consecutive IDs, which must be updated on segmentation edits. Non-terminal IDs occupy numbers starting after the last EDU. The format for each EDU/non-terminal node's ID, relation label, parent and type (the latter only for non-terminals) is:

2:joint-list:5 (EDU with ID 2, parent 5, relation 'joint-list')
5:multinuc:causal-cause:1 (node with ID 5, type multinuc, relation causal-cause and parent 1)

Note that also EDUs are 'terminal' in the sense that they can't cover any text except their contents, RST allows satellite nodes on EDUs, which then have the parent EDU number as the parent ID (see .rs4 XML). A root node (or one that has no parent yet because editing is in progress) will omit the relation name and parent ID, e.g.: 7:span (a span with node 7, currently no parent or outgoing relation label).
