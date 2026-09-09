from typing import Optional
from lxml import etree

# In-memory mock of the W3C xml.xsd
# We include lang, space, and id as they are the standard attributes in this namespace.
MOCK_XML_XSD = b"""<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://www.w3.org/XML/1998/namespace" 
           xml:lang="en">
    <xs:attribute name="lang" type="xs:string"/>
    <xs:attribute name="id" type="xs:ID"/>
    <xs:attribute name="space">
        <xs:simpleType>
            <xs:restriction base="xs:NCName">
                <xs:enumeration value="default"/>
                <xs:enumeration value="preserve"/>
            </xs:restriction>
        </xs:simpleType>
    </xs:attribute>
</xs:schema>"""


class W3CInterceptor(etree.Resolver):
    """Intercepts network requests for W3C schemas and serves them locally."""
    def resolve(self, url, pubid, context):
        # Target the exact URL your unmodified XSD is requesting
        if url == "http://www.w3.org/2001/xml.xsd":
            return self.resolve_string(MOCK_XML_XSD, context)
        
        # Return None to let lxml handle any other URLs normally
        return None


def _format_message(message: str, xsd_filename: Optional[str], reformat: bool) -> str:
    """Prefixes a single error message with an "xsd '<filename>':" label when reformatting for badge display."""
    if not reformat:
        return message
    prefix = f"xsd '{xsd_filename}': " if xsd_filename else "xsd: "
    return f"{prefix}{message}"


def validate_xml_string(
    xsd_string: str,
    xml_string: str,
    xsd_filename: Optional[str] = None,
    reformat: bool = False,
) -> tuple[bool, str]:
    """Validates an XML string against an XSD schema string using lxml.

    Args:
        xsd_string: The XSD schema as a string.
        xml_string: The XML document as a string.
        xsd_filename: Name of the schema file, used to label messages when reformatting.
        reformat: If True (used by the API), emits one "xsd '<filename>': <message>" line
            per error so downstream UIs that expect one error per line can split on newlines.

    Returns:
        A tuple containing:
            - bool: True if valid, False otherwise.
            - str: Validation success message or detailed error string.
    """
    try:
        # 1. Create a parser and attach the interceptor
        parser = etree.XMLParser()
        parser.resolvers.add(W3CInterceptor())

        # 2. Parse the XSD schema string using the intercepted parser
        schema_root = etree.fromstring(xsd_string.encode('utf-8'), parser=parser)
        schema = etree.XMLSchema(schema_root)
    except (etree.XMLSyntaxError, etree.XMLSchemaParseError) as err:
        return False, _format_message(f"Invalid XSD schema: {err}", xsd_filename, reformat)

    try:
        # Parse the XML string
        xml_doc = etree.fromstring(xml_string.encode('utf-8'))
    except etree.XMLSyntaxError as err:
        return False, _format_message(f"XML Parsing Error: {err}", xsd_filename, reformat)

    # Validate the XML against the schema
    is_valid = schema.validate(xml_doc)

    if is_valid:
        return True, "XML is valid according to the provided XSD schema."

    # Format all validation errors captured by the schema validator log, one per reported line
    error_messages = []
    for error in schema.error_log:
        location = f"Line {error.line}, Column {error.column}: " if error.line and error.line > 0 else ""
        error_messages.append(_format_message(f"{location}{error.message}", xsd_filename, reformat))

    if reformat:
        return False, "\n".join(error_messages)
    return False, "Validation Errors Found:\n" + "\n".join(error_messages)


# --- Example Usage ---
if __name__ == "__main__":
    sample_xsd = """<?xml version="1.0" encoding="UTF-8"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="note">
            <xs:complexType>
                <xs:sequence>
                    <xs:element name="to" type="xs:string"/>
                    <xs:element name="from" type="xs:string"/>
                    <xs:element name="heading" type="xs:string"/>
                    <xs:element name="body" type="xs:string"/>
                </xs:sequence>
                <xs:attribute name="date" type="xs:date" use="optional"/>
                <xs:attribute name="id" type="xs:string" use="required"/>
            </xs:complexType>
        </xs:element>
    </xs:schema>"""

    # Invalid XML (missing <body/> tag)
    invalid_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <note>
        <to>Tove</to>
        <from>Jani</from>
        <heading>Reminder</heading>
    </note>"""

    
    sample_xsd_filename = "C:\\Uni\\Corpora\\gum\\github\\_build\\src\\gum_schema_no_s.xsd"
    sample_xsd = open(sample_xsd_filename, 'r', encoding='utf-8').read()
    
    invalid_xml = """<?xml version="1.0" encoding="UTF-8"?><text id="GUM_exchange_superintelligence">
    <p>
    hello
    </p>
    </text>
    """

    valid, result_msg = validate_xml_string(sample_xsd, invalid_xml)
    print(f"Is Valid: {valid}\n")
    print(result_msg)