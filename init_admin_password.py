from modules.dataenc import pass_enc
from passlib.apps import custom_app_context
from modules.configobj import ConfigObj

if raw_input:
    p = raw_input("Enter a password for user `admin`:\n")
else:
    p = input("Enter a password for user `admin`:\n")

try:
    admin = ConfigObj('users/admin.ini')
    admin['password'] = pass_enc(custom_app_context.hash(p,salt="")) 
    admin.write()
    print("Successfully changed password for admin.")
except Exception as e:
    print("Could not change password for admin.")
    raise e
