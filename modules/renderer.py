import platform
import os
from pystache.renderer import Renderer

if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

def render(template_name, variables, template_dir='templates', file_ext=".mustache"):
    """
    Render a mustache template given a dict representing its variables.

    Args:
        template_name (str): the name of the template to be rendered
        variables (dict): a string -> any dict holding values of variables used in the template
        template_dir (str): the template directory, relative to the GitDox root directory.
                            Defaults to 'templates'
        file_ext (str): the file extension of templates. Defaults to '.mustache'

    Returns:
        str: rendered HTML.
    """
    # load shared Mustache templates so we can reference them in our large templates
    partials_dir = prefix + template_dir + os.sep + 'partials' + os.sep
    partials = dict([(filename[:-len(file_ext)], open(partials_dir + filename, 'r').read())
                                    for filename in os.listdir(prefix + template_dir + os.sep + 'partials')
                                    if filename.endswith(file_ext)])
    renderer = Renderer(partials=partials)

    return renderer.render_path(prefix + template_dir + os.sep + template_name + file_ext, variables)
