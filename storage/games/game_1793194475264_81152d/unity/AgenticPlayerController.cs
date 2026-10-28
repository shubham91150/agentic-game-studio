using UnityEngine;

public class AgenticPlayerController : MonoBehaviour
{
    public float speed = 14f;
    public float jumpVelocity = 9.5f;
    public float gravity = -16f;

    private Vector3 velocity;
    private bool isGrounded;

    private void Update()
    {
        float moveX = Input.GetAxisRaw("Horizontal");
        float moveZ = Input.GetAxisRaw("Vertical");

        Vector3 move = new Vector3(moveX, 0f, moveZ).normalized * speed;
        move = transform.TransformDirection(move);

        isGrounded = transform.position.y <= 0.001f && velocity.y <= 0f;
        if (isGrounded)
        {
            if (velocity.y < 0f)
            {
                velocity.y = 0f;
            }
            transform.position = new Vector3(transform.position.x, 0f, transform.position.z);
        }

        if (isGrounded && Input.GetKeyDown(KeyCode.Space))
        {
            velocity.y = jumpVelocity;
        }

        velocity.y += gravity * Time.deltaTime;

        Vector3 motion = new Vector3(move.x, velocity.y, move.z);
        transform.position += motion * Time.deltaTime;
    }
}
