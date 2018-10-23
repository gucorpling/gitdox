class Validator(object):
    """
    Abstract class that all GitDox validations should inherit from.
    When at all possible, all Validation classes should not produce any
    side-effects: there should be no SQL queries, filesystem operations,
    etc. caused by a validation.

    Conceptually, an instance of this class represents a single validation
    "rule" against which a document will be checked.
    """

    def validate(self, doc, *args, **kwargs):
        raise NotImplementedError
