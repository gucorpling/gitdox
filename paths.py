import requests, os, platform
from modules.configobj import ConfigObj

# URL for ethercalc spreadsheets, possible including authentication
# e.g. http://mydomain.com/ethercalc/
# to use password authentication, use a netrc file called .netrc in the project root
ether_url = "http://mydomain.com/ethercalc/"

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""


def get_menu():
	config = ConfigObj(prefix + "users" + os.sep + "config.ini")
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
