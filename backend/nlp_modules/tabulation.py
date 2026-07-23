"""
dummy script to validate XML input as TT SGML and return it to the user for spreadsheet tabulation
"""

import re

def validate_tt(sgml):
    """
    Check that every line has exactly one of:
    1. a single opening tag <xyz( attr="val")+>
    2. a single closing tag
    3. plain text content (not(begins with and ends with < >))

    :param sgml:
    :return: Boolean
    """
    lines = sgml.split('\n')

    for line in lines:
        # Check for well-formed closing tag
        if re.match(r'</[A-Za-z0-9_:-]+>',line) is not None:
            continue
        elif re.search(r'<[A-Za-z0-9_:-]+( [A-Za-z0-9_:-]+="[^"]+")*>',line) is not None:
            continue
        elif not(line.startswith("<") and line.endswith(">")):
            continue
        else:
            return False
    return True
