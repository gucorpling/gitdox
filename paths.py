import requests, os, platform
from modules.configobj import ConfigObj

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

gitdox_root = os.path.dirname(os.path.realpath(__file__))

# to use password authentication, use a netrc file called .netrc in the project root
try:
	ether_url = ConfigObj(gitdox_root + os.sep + "users" + os.sep + "config.ini")["ether_url"]
	if not ether_url.endswith(os.sep):
		ether_url += os.sep
except KeyError:
	ether_url = ""

def get_menu():
	config = ConfigObj(prefix + "users" + os.sep + "config.ini")

	if "banner" not in config:
		return ""
	banner = config["banner"]

	if banner.startswith("http"):  # Web resource
		resp = requests.get(banner)
		return resp.text
	else:  # File name in templates/ dir
		banner = config["banner"]
		banner = open(prefix + "templates" + os.sep + banner).read()
		return banner


def get_nlp_credentials():
	config = ConfigObj("users" + os.sep + "config.ini")
	return config["nlp_user"], config["nlp_password"]
