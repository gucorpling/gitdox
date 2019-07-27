import platform
import os
from modules.configobj import ConfigObj
from paths import get_menu
from pystache.renderer import Renderer

if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

rootpath = os.path.dirname(os.path.dirname(os.path.realpath(__file__))) + os.sep
userdir = rootpath + "users" + os.sep
config = ConfigObj(userdir + 'config.ini')

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
	template_dir = prefix + template_dir

	# load Mustache templates so we can reference them in our large templates
	templates = dict([(filename[:-len(file_ext)], open(template_dir + os.sep + filename, 'r').read())
					  for filename in os.listdir(template_dir)
					  if filename.endswith(file_ext)])
	renderer = Renderer(partials=templates)

	variables['skin_stylesheet'] = config['skin']
	variables['navbar_html'] = get_menu()
	return renderer.render_path(template_dir + os.sep + template_name + file_ext, variables)
