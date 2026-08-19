"""
Data model for a user
"""

from typing import Dict, Optional, Any
from dataclasses import dataclass


@dataclass
class User:
    """
    Model representing a user
    
    Attributes:
        uid: Unique identifier of the user in the active auth provider.
        email: User's email address (optional)
        permissions: User's permissions
    """
    uid: str
    email: Optional[str] = None
    permissions: Optional[Dict[str, any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the model to a dictionary
        
        Returns:
            Dictionary representing the user
        """
        result = {'uid': self.uid}
        
        if self.email:
            result['email'] = self.email
        
        if self.permissions:
            result['permissions'] = self.permissions
            
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'User':
        """
        Create a User instance from a dictionary
        
        Args:
            data: Dictionary containing the user's data
            
        Returns:
            Instance of User
        """
        return cls(
            uid=data.get('uid', ''),
            email=data.get('email'),
            permissions=data.get('permissions')
        )
