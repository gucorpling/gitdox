import requests

# URL for ethercalc spreadsheets, possible including authentication
# e.g. http://mydomain.com/ethercalc/
# or with basic auth https://user:password@mydomain.com/ethercalc/
ether_url = "http://mydomain.com/ethercalc/"


def get_menu():
	cs = "http://copticscriptorium.org/nav.html"
	resp = requests.get(cs)
	return resp.text

