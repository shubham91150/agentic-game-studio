using UnityEngine;

[RequireComponent(typeof(CharacterController))]
public class AgenticPlayerController : MonoBehaviour
{
    public float speed = 14f;
    public float jumpVelocity = 9.5f;
    public float gravity = -16f;

    private CharacterController controller;
    private float verticalVelocity;

    private void Awake()
    {
        controller = GetComponent<CharacterController>();
    }

    private void Update()
    {
        float horizontal = Input.GetAxis("Horizontal");
        float vertical = Input.GetAxis("Vertical");

        Vector3 move = new Vector3(horizontal, 0f, vertical);
        if (move.sqrMagnitude > 1f)
        {
            move.Normalize();
        }

        if (controller.isGrounded)
        {
            if (verticalVelocity < 0f)
            {
                verticalVelocity = -0.5f;
            }

            if (Input.GetButtonDown("Jump"))
            {
                verticalVelocity = jumpVelocity;
            }
        }

        verticalVelocity += gravity * Time.deltaTime;

        Vector3 velocity = move * speed;
        velocity.y = verticalVelocity;

        controller.Move(velocity * Time.deltaTime);
    }
}
